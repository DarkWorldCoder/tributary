'use strict';
// Copies that run. A git worktree starts from the last commit, so it lacks the gitignored files a project needs to
// run: .env files, local config. These are copied in, never linked, so one agent's edit can't change every copy.
// Which files: those listed in .worktreeinclude (gitignore syntax, the file Claude Code, the Codex app and
// Conductor also read), or by default the gitignored .env files. Only files git ignores are ever copied.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_PATTERNS = ['.env', '.env.*'];
const ENV_NAME = /^\.env(\..+)?$/;
const LIMITS = { files: 200, bytes: 5 * 1024 * 1024 };

// git with NUL-separated output; input goes to stdin.
const gitList = (cwd, args, input) => new Promise((resolve, reject) => {
  const child = execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
    // check-ignore exits 1 when nothing is ignored.
    if (err && !(args[0] === 'check-ignore' && err.code === 1)) return reject(err);
    resolve(String(stdout || '').split('\0').filter(Boolean));
  });
  if (input != null) child.stdin.end(input);
});

/** Gitignored files to copy into a new copy of the repository at `root`, as paths relative to it. */
async function includedFiles(root) {
  const list = path.join(root, '.worktreeinclude');
  const custom = fs.existsSync(list);
  const select = custom ? [`--exclude-from=${list}`] : DEFAULT_PATTERNS.flatMap((p) => ['-x', p]);
  // Untracked files matching the include patterns, then only those the repository itself ignores.
  const matched = await gitList(root, ['ls-files', '-z', '--others', '--ignored', ...select]);
  if (!matched.length) return [];
  const ignored = await gitList(root, ['check-ignore', '-z', '--stdin'], matched.join('\0'));
  const real = fs.realpathSync(root);
  const out = []; let bytes = 0;
  for (const rel of ignored) {
    if (!custom && !ENV_NAME.test(path.basename(rel))) continue;
    const abs = path.join(root, rel);
    let st; try { st = fs.lstatSync(abs); } catch { continue; }
    if (!st.isFile()) continue; // never a symlink, a folder or a device
    if (!fs.realpathSync(abs).startsWith(real + path.sep)) continue;
    if (out.length >= LIMITS.files || bytes + st.size > LIMITS.bytes) break;
    bytes += st.size; out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

/**
 * Copy the included files from `root` into the copy at `dest`. Files are created readable by you only (keeping
 * your execute bit), and a file already in the copy is left alone. -> the paths copied
 */
async function copyIncluded(root, dest) {
  const copied = [];
  for (const rel of await includedFiles(root)) {
    const from = path.join(root, rel); const to = path.join(dest, rel);
    if (fs.existsSync(to)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, fs.readFileSync(from), { flag: 'wx', mode: (fs.statSync(from).mode & 0o700) | 0o600 });
      copied.push(rel);
    } catch { /* skipped: unreadable, or created meanwhile */ }
  }
  return copied;
}

/** Of the copied paths, those git no longer ignores in `dir` (un-ignored or force-added); a commit leaves them out. */
async function unignoredCopies(dir, copied) {
  if (!copied || !copied.length) return [];
  const still = new Set(await gitList(dir, ['check-ignore', '-z', '--stdin'], copied.join('\0')));
  return copied.filter((rel) => !still.has(rel));
}

// Each copy gets a block of ports, so dev servers in two copies don't both want 3000: TRIBUTARY_PORT to
// TRIBUTARY_PORT + 9, with PORT set to the first. The project folder itself keeps its usual ports.
const PORTS = { base: 4400, block: 10 };
const freePort = (used) => { let port = PORTS.base; while (used.has(port)) port += PORTS.block; return port; };
const copyEnv = (copy, root) => (copy && copy.port ? {
  TRIBUTARY_PORT: String(copy.port), PORT: String(copy.port), TRIBUTARY_WORKSPACE: copy.path, TRIBUTARY_ROOT_PATH: copy.root || root,
} : {});

module.exports = { includedFiles, copyIncluded, unignoredCopies, freePort, copyEnv, PORTS };
