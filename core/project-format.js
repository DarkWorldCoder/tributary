'use strict';
const fs = require('node:fs'); const fsp = require('node:fs/promises'); const path = require('node:path'); const crypto = require('node:crypto');
const { projectPath } = require('./files'); const { listFiles } = require('./git'); const { start, killTree } = require('./proc');
const MAX_FILES = 400; const MAX_BYTES = 8 * 1024 * 1024; const TTL = 10 * 60 * 1000;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const GENERATED = /(^|\/)(node_modules|\.git|dist|build|target|vendor|coverage|release|\.next|__pycache__)(\/|$)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum)$|\.min\.[cm]?js$/i;
const SUPPORTED = /\.(?:[cm]?[jt]sx?|json[5c]?|css|scss|less|html?|vue|mdx?|markdown|ya?ml|graphql|gql|go|rs|pyi?|c|h|cc|cpp|cxx|hh|hpp|hxx|java|cs|mm?|zig|sh|bash|bats|lua|luau|toml)$/i;
function runFormatter(root, files, trusted, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let worker = path.join(__dirname, 'format-worker.cjs');
    if (worker.includes('app.asar' + path.sep)) worker = worker.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const child = start(process.execPath, [worker], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdin: JSON.stringify({ root, files, trusted }) });
    let output = ''; let error = ''; let bytes = 0; let done = false;
    const finish = (failure, value) => { if (done) return; done = true; clearTimeout(timer); if (failure) { killTree(child); reject(failure); } else resolve(value); };
    const timer = setTimeout(() => finish(new Error('Formatting timed out. No files were saved.')), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > 20 * 1024 * 1024) finish(new Error('Formatting output is too large.')); else output += chunk; });
    child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-2000); });
    child.once('error', () => finish(new Error('Could not start the project formatter.')));
    child.once('close', (code) => {
      if (done) return;
      try {
        const marker = '\nTRIBUTARY_FORMAT_RESULT:'; const at = output.lastIndexOf(marker);
        if (code !== 0 || at < 0) throw new Error(error.trim().slice(0, 300) || 'Project formatter failed.');
        const result = JSON.parse(output.slice(at + marker.length));
        if (!Array.isArray(result.results) || result.results.length !== files.length || result.results.some((row, i) => row.rel !== files[i].rel || row.text != null && (typeof row.text !== 'string' || Buffer.byteLength(row.text) > 2 * 1024 * 1024))) throw new Error('Invalid formatter result.');
        finish(null, result);
      } catch (failure) { finish(failure); }
    });
  });
}
async function formatProjectResult(root, rel, text, trusted) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || text.includes('\0')) throw new Error('Format a text file up to 1 MB.');
  await projectPath(root, rel);
  return (await runFormatter(await fsp.realpath(root), [{ rel, text }], trusted, 15000)).results[0];
}
async function formatProjectSource(root, rel, text, trusted, automatic = false) {
  const result = await formatProjectResult(root, rel, text, trusted);
  if (result.status === 'unsupported' && automatic) return text;
  if (result.status === 'error' || result.status === 'unsupported') throw new Error(result.message || 'No formatter available.');
  return result.text ?? text;
}
function unified(before, after, rel) {
  const a = before.split('\n'); const b = after.split('\n'); let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  let endA = a.length; let endB = b.length;
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const start = Math.max(0, first - 3); const tail = Math.min(3, a.length - endA);
  return `--- ${rel}\n+++ ${rel} (formatted)\n@@ -${start + 1},${endA + tail - start} +${start + 1},${endB + tail - start} @@\n` + [
    ...a.slice(start, first).map((line) => ' ' + line), ...a.slice(first, endA).map((line) => '-' + line), ...b.slice(first, endB).map((line) => '+' + line), ...a.slice(endA, endA + tail).map((line) => ' ' + line),
  ].join('\n');
}
class ProjectFormatter {
  constructor({ trusted, write }) { this.trusted = trusted; this.write = write; this.plans = new Map(); this.busy = new Set(); }
  prune() { for (const [id, plan] of this.plans) if (Date.now() - plan.created > TTL) this.plans.delete(id); }
  plan(root, token) { this.prune(); const plan = this.plans.get(token); if (!plan || plan.root !== root) throw new Error('Formatting preview expired. Scan again.'); return plan; }
  async preview(root, exclude = []) {
    if (!Array.isArray(exclude) || exclude.length > 2000 || exclude.some((rel) => typeof rel !== 'string')) throw new Error('Invalid unsaved file list.');
    if (!this.trusted(root)) throw new Error('Trust this project before formatting all files.');
    this.prune(); if (this.busy.has(root)) throw new Error('A formatting scan is already running for this project.'); this.busy.add(root);
    try {
      const candidates = (await listFiles(root)).sort(); const skip = new Set(exclude); const files = []; const rows = []; let bytes = 0; let limited = false;
      for (const rel of candidates) {
        if (!SUPPORTED.test(rel) || GENERATED.test(rel)) continue;
        if (skip.has(rel)) { rows.push({ rel, status: 'unsaved' }); continue; }
        if (files.length >= MAX_FILES) { limited = true; break; }
        try {
          const filename = await projectPath(root, rel); const stat = await fsp.stat(filename);
          if (!stat.isFile() || stat.size > 1024 * 1024) { rows.push({ rel, status: 'skipped', message: 'Not a text file up to 1 MB.' }); continue; }
          const buffer = await fsp.readFile(filename);
          if (buffer.includes(0) || /@generated|DO NOT EDIT/i.test(buffer.subarray(0, 2000).toString())) { rows.push({ rel, status: 'skipped', message: 'Generated or binary file.' }); continue; }
          bytes += buffer.length; if (bytes > MAX_BYTES) { limited = true; break; }
          const text = buffer.toString('utf8'); if (!Buffer.from(text).equals(buffer)) { rows.push({ rel, status: 'skipped', message: 'Not UTF-8 text.' }); continue; }
          files.push({ rel, text, mtime: stat.mtimeMs });
        } catch (error) { rows.push({ rel, status: 'error', message: error.message.slice(0, 200) }); }
      }
      const result = files.length ? await runFormatter(await fsp.realpath(root), files, true) : { results: [], sources: [] };
      const changed = new Map();
      for (let i = 0; i < result.results.length; i++) {
        const row = result.results[i]; const original = files[i];
        if (typeof row.text === 'string' && row.text !== original.text) {
          changed.set(row.rel, { ...original, after: row.text }); rows.push({ rel: row.rel, status: 'changed' });
        } else rows.push({ rel: row.rel, status: row.status || 'unchanged', ...(row.message ? { message: row.message } : {}) });
      }
      // Keep one bounded preview per project, and at most two projects in memory.
      for (const [token, plan] of this.plans) if (plan.root === root) this.plans.delete(token);
      while (this.plans.size >= 2) this.plans.delete(this.plans.keys().next().value);
      const config = [];
      for (const source of result.sources || []) { const filename = await fsp.realpath(source); if ((await fsp.stat(filename)).size > 1024 * 1024) throw new Error('Formatting config is too large.'); config.push({ filename, hash: hash(await fsp.readFile(filename)) }); }
      const token = crypto.randomUUID(); this.plans.set(token, { root, created: Date.now(), changed, config, applied: new Map() });
      return { token, rows, limited, scanned: files.length };
    } finally { this.busy.delete(root); }
  }
  diff(root, token, rel) { const file = this.plan(root, token).changed.get(rel); if (!file) throw new Error('File is not in this preview.'); return unified(file.text, file.after, rel); }
  async apply(root, token, selected, exclude = [], undo = false) {
    if (!this.trusted(root)) throw new Error('Trust this project before formatting files.');
    const plan = this.plan(root, token);
    if (!Array.isArray(selected) || selected.length > MAX_FILES || selected.some((rel) => typeof rel !== 'string') || !Array.isArray(exclude) || exclude.length > 2000 || exclude.some((rel) => typeof rel !== 'string')) throw new Error('Invalid formatting selection.');
    if (this.busy.has(root)) throw new Error('Formatting is already running.'); this.busy.add(root);
    try {
      if (!undo) for (const config of plan.config) { try { if ((await fsp.stat(config.filename)).size > 1024 * 1024 || hash(await fsp.readFile(config.filename)) !== config.hash) throw new Error('changed'); } catch { throw new Error('Formatting rules changed. Scan again.'); } }
      const rows = []; const skip = new Set(exclude);
      for (const rel of new Set(selected)) {
        const file = (undo ? plan.applied : plan.changed).get(rel);
        if (!file) { rows.push({ rel, status: 'skipped' }); continue; }
        if (skip.has(rel)) { rows.push({ rel, status: 'conflict', message: 'Unsaved draft. Kept your version.' }); continue; }
        try {
          const filename = await projectPath(root, rel); const stat = await fsp.stat(filename);
          if (stat.size > 2 * 1024 * 1024) { rows.push({ rel, status: 'conflict', message: 'File grew since preview. Kept the newer file.' }); continue; }
          const current = await fsp.readFile(filename);
          const expected = undo ? file.after : file.text; const next = undo ? file.text : file.after;
          if (current.length > 2 * 1024 * 1024 || hash(current) !== hash(expected)) { rows.push({ rel, status: 'conflict', message: 'Changed since preview. Kept the newer file.' }); continue; }
          await this.write(root, rel, next, stat.mtimeMs);
          if (undo) plan.applied.delete(rel); else plan.applied.set(rel, file);
          rows.push({ rel, status: undo ? 'restored' : 'formatted' });
        } catch (error) { rows.push({ rel, status: 'error', message: error.message.slice(0, 200) }); }
      }
      return { rows, undoable: [...plan.applied.keys()] };
    } finally { this.busy.delete(root); }
  }
}
module.exports = { ProjectFormatter, formatProjectSource, formatProjectResult, supportsProjectFormat: rel => SUPPORTED.test(rel), unified };
