'use strict';
// Git helpers. Each takes an optional { host } (core/host.js) so a project on an SSH host is read there.
const fs = require('fs');
const path = require('path');
const { localHost } = require('./host');

const run = (cwd, args, max = 200000, host = localHost) => host.exec('git', args, { cwd, timeout: 8000, maxBuffer: max * 4 })
  .then((r) => (r.code === 0 ? String(r.stdout) : null));

async function gitInfo(cwd, { host = localHost } = {}) {
  const top = await run(cwd, ['rev-parse', '--show-toplevel'], undefined, host);
  if (!top) return null;
  const [branch, status, stat] = await Promise.all([
    run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], undefined, host),
    run(cwd, ['status', '--short', '--untracked-files=all'], undefined, host),
    run(cwd, ['diff', 'HEAD', '--stat', '--stat-width=100'], undefined, host),
  ]);
  const changed = (status || '').split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3).replace(/^"|"$/g, '') }));
  return { root: top.trim(), branch: (branch || '').trim(), changed, stat: (stat || '').trim() };
}

// Fingerprint dirty files so we can tell which ones a turn touched, however it edited them.
function fingerprint(root, changed) {
  const m = new Map();
  for (const c of changed || []) { try { const st = fs.statSync(path.join(root, c.path)); m.set(c.path, `${st.mtimeMs}:${st.size}`); } catch { m.set(c.path, 'deleted'); } }
  return m;
}
// The same, on any host (one round trip for a remote one).
async function fingerprintsOn(host, root, changed) {
  const abs = (changed || []).map((c) => host.path.join(root, c.path));
  const prints = await host.fingerprints(abs);
  return new Map((changed || []).map((c, i) => [c.path, prints.get(abs[i])]));
}
// prev: fingerprint Map taken before the turn; after: gitInfo() after the turn; now: after's
// fingerprints when they were taken elsewhere (fingerprintsOn).
function touched(prev, after, now) {
  if (!after) return [];
  prev = prev || new Map();
  now = now || fingerprint(after.root, after.changed);
  const out = [];
  for (const c of after.changed) if (prev.get(c.path) !== now.get(c.path)) out.push(c);
  for (const [p] of prev) if (!now.has(p)) out.push({ code: 'reverted', path: p });
  return out;
}

async function fileDiff(cwd, rel, { host = localHost } = {}) {
  const tracked = await run(cwd, ['ls-files', '--error-unmatch', '--', rel], undefined, host);
  if (tracked) return (await run(cwd, ['diff', 'HEAD', '--', rel], 5_000_000, host)) || '';
  try { const t = (await host.readFile(host.path.join(cwd, rel))).toString('utf8'); return `new file ${rel}\n` + t.split('\n').map((l) => `+${l}`).join('\n'); } catch { return ''; }
}

const headContent = (cwd, rel, { host = localHost } = {}) => run(cwd, ['show', `HEAD:${rel.replace(/\\/g, '/')}`], 5_000_000, host);

const SKIP = ['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', '.next'];

// Files for @-mentions: tracked and untracked, honoring .gitignore. Falls back to a shallow walk.
async function listFiles(cwd, limit = 20000, { host = localHost } = {}) {
  const out = await run(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], 50_000_000, host);
  if (out != null) return [...new Set(out.split('\0').filter(Boolean))].slice(0, limit);
  if (host.remote) {
    const prune = SKIP.flatMap((n, i) => [...(i ? ['-o'] : []), '-name', n]);
    const r = await host.exec('find', ['.', '-maxdepth', '7', '(', ...prune, '-o', '-name', '.*', '!', '-name', '.', ')', '-prune', '-o', '-type', 'f', '-print'], { cwd, timeout: 15000 });
    return r.stdout.split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, '')).slice(0, limit);
  }
  const files = []; const skip = new Set(SKIP);
  const walk = (dir, depth) => {
    if (depth > 6 || files.length >= limit) return;
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (skip.has(e.name) || e.name.startsWith('.')) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, depth + 1); else files.push(path.relative(cwd, p)); }
  };
  walk(cwd, 0); return files;
}

async function commitAll(cwd, message, { host = localHost } = {}) {
  const sh = async (args) => { const r = await host.exec('git', args, { cwd, timeout: 30000 }); if (r.code !== 0) throw new Error(String(r.stderr || r.stdout).trim()); return String(r.stdout); };
  await sh(['add', '-A']);
  const out = await sh(['commit', '-m', message]);
  return out.split('\n')[0];
}

module.exports = { gitInfo, headContent, fileDiff, touched, fingerprint, fingerprintsOn, listFiles, commitAll };
