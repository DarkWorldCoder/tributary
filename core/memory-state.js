'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX = 256 * 1024;
const revision = (text) => crypto.createHash('sha256').update(text || '').digest('hex');

// App-owned state may not follow links. This does not sandbox hostile concurrent filesystem edits.
function location(project, rel) {
  let target = fs.realpathSync(project);
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid memory path.');
    target = path.join(target, part);
    try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Memory paths must not be symbolic links.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}
function read(project, rel, { tail = false, max = MAX } = {}) {
  const file = location(project, rel);
  let fd;
  try {
    fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size;
    if (!tail && size > max) throw new Error('Project memory is too large. Keep it below 256 KB.');
    const buffer = Buffer.alloc(Math.min(size, max)); fs.readSync(fd, buffer, 0, buffer.length, tail ? Math.max(0, size - max) : 0);
    return buffer.toString('utf8');
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function atomic(project, rel, text) {
  const file = location(project, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function locked(project, fn) {
  const lock = location(project, '.tributary/memory.lock'); fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) { if (e.code !== 'EEXIST') throw e; throw new Error('Memory is being updated, or a previous update left memory.lock. Retry; if the app crashed, remove that lock after confirming no editor is saving.'); }
  try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function ignorePrivateFiles(project) {
  const rel = '.tributary/.gitignore'; const current = read(project, rel) || '';
  if (!current.includes('# tributary private memory state')) atomic(project, rel, `${current.replace(/\s*$/, '')}\n# tributary private memory state\n/memory-history/\n/memory-settings.json\n/memory.lock\n/*.tmp\n`);
}
function settings(project) {
  const text = read(project, '.tributary/memory-settings.json');
  if (!text) return { includeInPrompts: false, budget: 4000 };
  let data; try { data = JSON.parse(text); } catch { throw new Error('Memory settings could not be read. Check .tributary/memory-settings.json.'); }
  return { includeInPrompts: data.includeInPrompts === true, budget: [2000, 4000, 8000].includes(data.budget) ? data.budget : 4000 };
}
function configure(project, input) {
  if (typeof input?.includeInPrompts !== 'boolean' || ![2000, 4000, 8000].includes(input.budget)) throw new Error('Choose a memory sharing option and a supported context budget.');
  return locked(project, () => { ignorePrivateFiles(project); atomic(project, '.tributary/memory-settings.json', JSON.stringify({ includeInPrompts: input.includeInPrompts, budget: input.budget })); return settings(project); });
}
function history(project) {
  const dir = location(project, '.tributary/memory-history');
  let entries; try { entries = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return entries.filter((name) => /^[a-f0-9]{64}\.md$/.test(name)).map((name) => ({ revision: name.slice(0, -3), savedAt: fs.statSync(location(project, `.tributary/memory-history/${name}`)).mtimeMs })).sort((a, b) => b.savedAt - a.savedAt);
}
function previous(project, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid memory version.');
  const text = read(project, `.tributary/memory-history/${id}.md`);
  if (text === null) throw new Error('Memory version no longer exists.');
  return text;
}
function save(project, text, expected) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX) throw new Error('Keep project memory below 256 KB.');
  return locked(project, () => {
    ignorePrivateFiles(project);
    const current = read(project, '.tributary/memory.md') || '';
    if (expected !== undefined && expected !== revision(current)) throw new Error('Project memory changed since you opened it. Your draft is preserved. Load the latest version before merging and saving.');
    if (current === text) return revision(current);
    if (current) atomic(project, `.tributary/memory-history/${revision(current)}.md`, current);
    atomic(project, '.tributary/memory.md', text);
    for (const old of history(project).slice(20)) fs.unlinkSync(location(project, `.tributary/memory-history/${old.revision}.md`));
    return revision(text);
  });
}
function retrieve(project, query, budget = settings(project).budget, matchesOnly = false) {
  if (![2000, 4000, 8000].includes(budget)) throw new Error('Unsupported memory context budget.');
  const text = read(project, '.tributary/memory.md') || '';
  const words = new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []);
  let section = ''; const candidates = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (/^#+ /.test(line)) { section = line.replace(/^#+ /, ''); continue; }
    if (!line.trim()) continue;
    const terms = new Set(line.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []);
    const score = [...words].filter((word) => terms.has(word)).length;
    if (matchesOnly && words.size && !score) continue;
    candidates.push({ source: '.tributary/memory.md', line: index + 1, text: line.slice(0, 1500), score: score * 10 + (/decisions|run|test|gotchas/i.test(section) ? 1 : 0) });
  }
  candidates.sort((a, b) => b.score - a.score || a.line - b.line);
  const selected = []; const seen = new Set(); let used = 0;
  for (const item of candidates) {
    const normalized = item.text.replace(/^\s*[-*]\s+/, '').trim();
    if (seen.has(normalized)) continue;
    const rendered = `[${item.source}:${item.line}] ${item.text}`;
    const extra = rendered.length + (selected.length ? 1 : 0);
    if (used + extra > budget) continue;
    seen.add(normalized); selected.push({ ...item, rendered }); used += extra;
  }
  return { text: selected.map((x) => x.rendered).join('\n'), sources: selected.map(({ source, line }) => ({ source, line })), characters: used, budget, omitted: candidates.length - selected.length };
}
module.exports = { location, read, atomic, locked, revision, settings, configure, history, previous, save, retrieve, ignorePrivateFiles };
