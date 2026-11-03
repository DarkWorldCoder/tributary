'use strict';
// Separate working copies: a conversation can work in its own git worktree on its own branch, so two
// conversations can change one repository at once. The copy starts from the project's last commit;
// nothing reaches the project folder until the branch is merged back into the project's current branch.
// Every function takes an optional { host } (core/host.js), like the other git helpers.
const { localHost } = require('./host');
const { unignoredCopies } = require('./workspace-setup');

const gitRaw = async (host, cwd, args, { env } = {}) => {
  const r = await host.exec('git', args, { cwd, env, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.code, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
};
const git = async (host, cwd, args, opts) => {
  const r = await gitRaw(host, cwd, args, opts);
  if (r.code) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
};
const paths = (out) => out.split('\0').filter(Boolean);

// Commits made for you carry your git identity; Tributary's stands in only for what is not set.
async function identity(host, cwd) {
  const [name, email] = await Promise.all(['user.name', 'user.email'].map((k) => gitRaw(host, cwd, ['config', k])));
  return {
    ...(name.code ? { GIT_AUTHOR_NAME: 'Tributary', GIT_COMMITTER_NAME: 'Tributary' } : {}),
    ...(email.code ? { GIT_AUTHOR_EMAIL: 'tributary@localhost', GIT_COMMITTER_EMAIL: 'tributary@localhost' } : {}),
  };
}
// Commit everything not yet committed in the copy to its branch, except files copied in from the project
// (.env and the like), even if an agent un-ignored them.
async function commitWork(host, dir, message, copied) {
  const skip = host.remote ? [] : await unignoredCopies(dir, copied);
  await git(host, dir, ['add', '-A', '--', '.', ...skip.map((rel) => `:(exclude,literal)${rel}`)]);
  if ((await gitRaw(host, dir, ['diff', '--cached', '--quiet'])).code) await git(host, dir, ['commit', '--no-verify', '-q', '-m', message], { env: await identity(host, dir) });
}
const DEFAULT_MESSAGE = 'Work from a Tributary conversation';
const currentBranch = async (host, cwd) => (await gitRaw(host, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() || 'HEAD';

/** Add a worktree at `dir` on a new `branch` from the repository's current commit. -> { path, branch, base, from } */
async function createWorktree(root, { dir, branch, host = localHost }) {
  const head = await gitRaw(host, root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head.code) throw new Error('Make a first commit in this repository before working in a separate copy.');
  if (!(await gitRaw(host, root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).code) throw new Error(`A branch named ${branch} already exists. Delete or rename it, then try again.`);
  const base = head.stdout.trim();
  await host.mkdir(host.path.dirname(dir));
  await git(host, root, ['worktree', 'add', '-b', branch, dir, base]);
  return { path: await host.realpath(dir), branch, base, from: await currentBranch(host, root) };
}

/**
 * Where the copy stands against the project's current branch.
 * -> { branch, path, into, ahead, behind, uncommitted, files: [{ path, code }] }, or { missing: true } when the folder is gone.
 * files: everything that differs from where the two branches split, committed or not.
 */
async function worktreeStatus(root, { path: dir, branch }, { host = localHost } = {}) {
  if (!(await host.exists(dir))) return { branch, path: dir, missing: true, ahead: 0, behind: 0, uncommitted: 0, files: [] };
  const into = await currentBranch(host, root);
  const [behind, ahead] = (await git(host, root, ['rev-list', '--left-right', '--count', `HEAD...${branch}`])).trim().split(/\s+/).map(Number);
  const forkPoint = (await git(host, dir, ['merge-base', 'HEAD', (await git(host, root, ['rev-parse', 'HEAD'])).trim()])).trim();
  const [changed, untracked, status] = await Promise.all([
    git(host, dir, ['diff', '--name-status', '--no-renames', '-z', forkPoint]),
    git(host, dir, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(host, dir, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames']),
  ]);
  const p = paths(changed); const files = [];
  for (let i = 0; i + 1 < p.length; i += 2) files.push({ path: p[i + 1], code: p[i] });
  for (const f of paths(untracked)) files.push({ path: f, code: 'A' });
  return { branch, path: dir, into, ahead, behind, uncommitted: paths(status).length, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

const conflictError = (message, conflicts) => Object.assign(new Error(message), { conflicts });

/**
 * Merge the copy's branch into the project's current branch. Work not yet committed in the copy is committed
 * on its branch first. Conflicts are found with git merge-tree, which touches no files; a merge that would
 * conflict, or overwrite uncommitted changes in the project folder, is refused with the files named; so is one that
 * `scan` objects to.
 * -> { into, branch, commit, files } (files: paths the merge changed in the project, [] when there was nothing new)
 */
async function mergeWorktree(root, { path: dir, branch, copied }, { message = DEFAULT_MESSAGE, host = localHost, scan } = {}) {
  if (!(await host.exists(dir))) throw new Error(`The separate copy at ${dir} is gone. Discard it to work in the project folder again.`);
  await commitWork(host, dir, message, copied);
  const into = await currentBranch(host, root);
  const ours = (await git(host, root, ['rev-parse', 'HEAD'])).trim();
  const theirs = (await git(host, root, ['rev-parse', branch])).trim();
  if (!(await gitRaw(host, root, ['merge-base', '--is-ancestor', theirs, ours])).code) return { into, branch, commit: ours, files: [] };
  const kept = `The work is kept on branch ${branch} so you or an agent can merge it.`;
  const m = await gitRaw(host, root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs]);
  const out = m.stdout.trim().split('\n');
  if (m.code === 1) {
    const files = [...new Set(out.slice(1).filter(Boolean))];
    throw conflictError(`Can't merge cleanly: these files conflict with changes made on ${into} since this conversation started: ${files.join(', ')}. ${kept}`, files);
  }
  if (m.code) throw new Error(`Could not merge the changes: ${m.stderr.trim()}`);
  // scan(diff of what the merge adds) -> an error to refuse with, e.g. a secret about to be committed.
  const refused = scan && await scan(await git(host, root, ['diff', '--no-color', '--no-ext-diff', ours, out[0]]));
  if (refused) throw refused;
  const files = paths(await git(host, root, ['diff', '--name-only', '-z', ours, out[0]]));
  const dirty = new Set(paths(await git(host, root, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'])).map((l) => l.slice(3)));
  const blocked = files.filter((f) => dirty.has(f));
  if (blocked.length) throw conflictError(`These files have uncommitted changes in the project folder: ${blocked.join(', ')}. Commit or undo them, then merge again. ${kept}`, blocked);
  await git(host, root, ['merge', '--ff', '--no-edit', '--no-verify', '-q', '-m', `Merge ${branch}: ${message}`, theirs], { env: await identity(host, root) });
  return { into, branch, commit: (await git(host, root, ['rev-parse', 'HEAD'])).trim(), files };
}

/**
 * Remove the copy's folder and its branch, which loses any work not merged. With keepBranch, work not yet
 * committed is committed to the branch first, and the branch stays.
 */
async function removeWorktree(root, { path: dir, branch, copied }, { keepBranch = false, message = DEFAULT_MESSAGE, host = localHost } = {}) {
  if (keepBranch && (await host.exists(dir))) await commitWork(host, dir, message, copied).catch(() => {});
  await gitRaw(host, root, ['worktree', 'remove', '--force', dir]);
  await host.rm(dir).catch(() => {});
  await gitRaw(host, root, ['worktree', 'prune']);
  if (!keepBranch) await gitRaw(host, root, ['branch', '-D', branch]);
}

module.exports = { createWorktree, worktreeStatus, mergeWorktree, removeWorktree };
