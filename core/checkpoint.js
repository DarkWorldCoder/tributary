'use strict';
// Git checkpoints: snapshot the whole working tree (tracked + untracked, honoring .gitignore)
// before each turn without touching the user's index, branch or stash, and restore it later.
//
// Checkpoint objects live in Tributary's own store (one per repository), not in the user's .git:
// git writes new objects there and reads the repository's objects through an alternate, so nothing
// is duplicated and no refs or objects pile up in the project (the approach OpenCode uses).
// Race mode passes { external: false } because its worktrees and branches belong in the repository.
// Every function takes an optional { host } (core/host.js); for an SSH host the store is on that host.
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { localHost } = require('./host');

const git = async (host, cwd, args, { env, buffer } = {}) => {
  const r = await host.exec('git', args, { cwd, env, timeout: 30000, maxBuffer: 256 * 1024 * 1024, encoding: buffer ? 'buffer' : 'utf8' });
  if (r.code !== 0) throw new Error(String(r.stderr).trim());
  return r.stdout;
};

const storeBase = async (host) => {
  if (!host.remote) return process.env.TRIBUTARY_CHECKPOINT_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tributary', 'checkpoints');
  return host.path.join((await host.info()).home, '.local', 'share', 'tributary', 'checkpoints');
};

// Environment changes that send new objects to the repository's checkpoint store. Remembered per
// repository on remote hosts, where each lookup is a network round trip.
const remembered = new WeakMap();
function storeEnv(root, host) {
  if (!host.remote) return findStore(root, host);
  if (!remembered.has(host)) remembered.set(host, new Map());
  const cache = remembered.get(host);
  if (!cache.has(root)) cache.set(root, findStore(root, host).catch((e) => { cache.delete(root); throw e; }));
  return cache.get(root);
}
async function findStore(root, host) {
  const common = (await git(host, root, ['rev-parse', '--git-common-dir'])).trim();
  const repoObjects = host.path.join(host.path.resolve(root, common), 'objects');
  const real = await host.realpath(root);
  const objects = host.path.join(await storeBase(host), crypto.createHash('sha1').update(real).digest('hex').slice(0, 16), 'objects');
  await host.mkdir(host.path.join(objects, 'info')); await host.mkdir(host.path.join(objects, 'pack'));
  return { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: repoObjects };
}

async function snapshotTree(root, { external = true, host = localHost } = {}) {
  const idx = host.path.join((await host.info()).tmp, `tributary-idx-${crypto.randomBytes(6).toString('hex')}`);
  const env = { ...(external ? await storeEnv(root, host) : {}), GIT_INDEX_FILE: idx };
  try {
    await git(host, root, ['read-tree', 'HEAD'], { env }).catch(() => {}); // empty repo has no HEAD
    await git(host, root, ['add', '-A', '--', '.'], { env });
    return (await git(host, root, ['write-tree'], { env })).trim();
  } finally { await host.rm(idx).catch(() => {}); }
}

// Create a checkpoint commit. The returned id is stored with the turn, so no ref is needed.
async function createCheckpoint(root, label, { external = true, host = localHost } = {}) {
  const tree = await snapshotTree(root, { external, host });
  const env = { ...(external ? await storeEnv(root, host) : {}), GIT_AUTHOR_NAME: 'Tributary', GIT_AUTHOR_EMAIL: 'tributary@localhost', GIT_COMMITTER_NAME: 'Tributary', GIT_COMMITTER_EMAIL: 'tributary@localhost' };
  return (await git(host, root, ['commit-tree', tree, '-m', `Tributary checkpoint: ${label}`], { env })).trim();
}

// Make the working tree match the checkpoint for every path that changed since.
async function restoreCheckpoint(root, commit, { host = localHost } = {}) {
  const env = await storeEnv(root, host);
  const current = await snapshotTree(root, { host });
  const out = await git(host, root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', `${commit}^{tree}`, current], { env });
  const parts = out.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i], rel: parts[i + 1] });
  // File modes for everything being put back, in one call.
  const back = changes.filter((c) => c.status !== 'A').map((c) => c.rel);
  const modes = new Map();
  if (back.length) {
    for (const entry of (await git(host, root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...back], { env })).split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t'); modes.set(entry.slice(tab + 1), entry.split(' ')[0]);
    }
  }
  let restored = 0; let removed = 0;
  for (const { status, rel } of changes) {
    const abs = host.path.join(root, rel);
    if (status === 'A') { await host.rm(abs); removed++; continue; } // created after the checkpoint
    const blob = await git(host, root, ['cat-file', 'blob', `${commit}:${rel}`], { buffer: true, env });
    const mode = modes.get(rel);
    if (mode === '120000') { await host.mkdir(host.path.dirname(abs)); await host.rm(abs); await host.symlink(blob.toString(), abs); } else await host.writeFile(abs, blob, { mode: mode === '100755' ? 0o755 : 0o644 });
    restored++;
  }
  return { restored, removed };
}

async function diffSince(root, commit, { host = localHost } = {}) {
  const current = await snapshotTree(root, { host });
  return git(host, root, ['diff', `${commit}^{tree}`, current, '--stat'], { env: await storeEnv(root, host) });
}

// Diff between a checkpoint and a later checkpoint (or the working tree now), optionally one file.
async function diffBetween(root, fromCommit, toCommit, rel, { host = localHost } = {}) {
  const to = toCommit ? `${toCommit}^{tree}` : await snapshotTree(root, { host });
  const args = ['diff', `${fromCommit}^{tree}`, to];
  if (rel) args.push('--', rel);
  return git(host, root, args, { env: await storeEnv(root, host) });
}
async function changedBetween(root, fromCommit, toCommit, { host = localHost } = {}) {
  const to = toCommit ? `${toCommit}^{tree}` : await snapshotTree(root, { host });
  const out = await git(host, root, ['diff', '--name-status', '-z', '--no-renames', `${fromCommit}^{tree}`, to], { env: await storeEnv(root, host) });
  const p = out.split('\0').filter(Boolean); const res = [];
  for (let i = 0; i + 1 < p.length; i += 2) res.push({ code: p[i], path: p[i + 1] });
  return res;
}

async function changeStatsBetween(root, fromCommit, toCommit, { host = localHost } = {}) {
  const to = toCommit ? `${toCommit}^{tree}` : await snapshotTree(root, { host });
  const out = await git(host, root, ['diff', '--numstat', '-z', '--no-renames', `${fromCommit}^{tree}`, to], { env: await storeEnv(root, host) });
  return require('./change-stats').parseNumstat(out);
}

module.exports = { changeStatsBetween, snapshotTree, createCheckpoint, restoreCheckpoint, diffSince, diffBetween, changedBetween };
