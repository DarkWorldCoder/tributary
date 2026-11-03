'use strict';
// Secrets stay out of merges, commits and transcripts. Agents commit with hooks off, so a team's own secret
// scanner never sees their work; this guard checks what would be added instead. It knows the values in the
// project's .env files whose names say they are secret, plus well-known token shapes. Values live in memory
// only, and every message names the file and the kind of secret, never the value.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SECRET_NAME = /SECRET|TOKEN|KEY|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL|PRIVATE|DSN/i;
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i;
const PATTERNS = [
  { kind: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'an age private key', re: /\bAGE-SECRET-KEY-(?:PQ-)?1[02-9AC-HJ-NP-Z]{58,}/ },
  { kind: 'an AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'a GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { kind: 'a Slack token', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'an OpenAI or Anthropic key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/ },
  { kind: 'a Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];
const MASK = '[REDACTED]';

class SecretGuard {
  constructor() { this.values = new Map(); this.longest = 0; } // value -> "NAME from file"

  add(value, label) {
    if (typeof value !== 'string' || value.length < 8 || this.values.has(value)) return;
    this.values.set(value, label); this.longest = Math.max(this.longest, value.length);
  }
  /** Learn from the text of an env file: KEY=VALUE lines, `export`, quotes and comments allowed. */
  addEnvText(text, source) {
    for (const line of String(text).split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/.exec(line); if (!m) continue;
      let value = m[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1); else value = value.replace(/\s+#.*$/, '');
      if (SECRET_NAME.test(m[1]) || URL_WITH_PASSWORD.test(value)) this.add(value, `${m[1]} from ${source}`);
    }
  }
  addEnvFile(file, source = path.basename(file)) {
    try { if (fs.statSync(file).size < 256 * 1024) this.addEnvText(fs.readFileSync(file, 'utf8'), source); } catch { /* gone */ }
  }

  /** What a unified diff would add: [{ file, kind }], one per file and kind. Removed and context lines are fine. */
  scanDiff(diff) {
    const found = []; const seen = new Set(); let file = null;
    const hit = (kind) => { const k = `${file}\0${kind}`; if (!seen.has(k)) { seen.add(k); found.push({ file, kind }); } };
    for (const line of String(diff).split('\n')) {
      if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
      if (!line.startsWith('+') || file == null) continue;
      for (const [value, label] of this.values) if (line.includes(value)) hit(label);
      for (const p of PATTERNS) if (p.re.test(line)) hit(p.kind);
    }
    return found;
  }

  redact(text) {
    if (typeof text !== 'string' || !this.values.size) return text;
    let out = text;
    for (const value of [...this.values.keys()].sort((a, b) => b.length - a.length)) if (out.includes(value)) out = out.split(value).join(MASK);
    return out;
  }
  /** Redact a growing text whose last `added` characters just arrived: only the new tail can hold a new value. */
  redactTail(text, added) {
    if (!this.values.size || typeof text !== 'string') return text;
    const tail = text.slice(-(added + this.longest));
    return [...this.values.keys()].some((v) => tail.includes(v)) ? this.redact(text) : text;
  }
  /** Redact every string in an event (and its nested objects), in place. */
  redactEvent(e, depth = 0) {
    if (!this.values.size || !e || typeof e !== 'object' || depth > 4) return e;
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === 'string') e[k] = this.redact(v);
      else if (v && typeof v === 'object') this.redactEvent(v, depth + 1);
    }
    return e;
  }
}

const gitOut = (cwd, args) => new Promise((resolve) => execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out))));
/** Everything "Commit all" would add in a repository, as a diff: changes to tracked files, then new files in full. */
async function pendingChanges(dir) {
  const root = (await gitOut(dir, ['rev-parse', '--show-toplevel'])).trim(); if (!root) return '';
  const tracked = await gitOut(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff']);
  let added = '';
  for (const rel of (await gitOut(root, ['ls-files', '-z', '--others', '--exclude-standard'])).split('\0').filter(Boolean)) {
    try {
      const file = path.join(root, rel); if (fs.statSync(file).size > 1024 * 1024) continue;
      added += `+++ b/${rel}\n${fs.readFileSync(file, 'utf8').split('\n').map((l) => `+${l}`).join('\n')}\n`;
    } catch { /* unreadable */ }
  }
  return tracked + added;
}

const secretError = (found) => Object.assign(new Error(`This would add what looks like a secret: ${found.slice(0, 5).map((f) => `${f.kind} in ${f.file}`).join('; ')}${found.length > 5 ? `, and ${found.length - 5} more` : ''}. Take it out, or choose to go ahead anyway.`), { secrets: found });

module.exports = { SecretGuard, secretError, pendingChanges, MASK };
