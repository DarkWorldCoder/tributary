'use strict';
// Where a project's commands and files live: this computer (localHost) or an SSH host (sshHost).
// Git helpers, checkpoints, race worktrees and agent turns take a host, so one code path drives both.
//
// Every host has the same async interface:
//   exec(cmd, args, { cwd, env, input, timeout, maxBuffer, encoding }) -> { code, stdout, stderr }
//   spawn(cmd, args, { cwd, env, stdin, keepOpen }) -> child process;  kill(child) stops its whole tree
//   readFile, writeFile, mkdir, rm, mkdtemp, realpath, symlink, chmod, stat, exists, fingerprints, info
// `env` is always a set of changes on top of the host's own environment (null unsets a variable).
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start, killTree } = require('./proc');
const ssh = require('./ssh');

const MAX_BUFFER = 64 * 1024 * 1024;

function mergeEnv(base, changes) {
  const env = { ...base };
  for (const [k, v] of Object.entries(changes || {})) { if (v == null) delete env[k]; else env[k] = String(v); }
  return env;
}

const fingerprintOf = (st) => `${st.mtimeMs}:${st.size}`;

const localHost = {
  remote: false,
  label: 'this computer',
  path,
  exec(cmd, args, { cwd, env, input, timeout = 0, maxBuffer = MAX_BUFFER, encoding = 'utf8' } = {}) {
    return new Promise((resolve) => {
      const c = execFile(cmd, args, { cwd, env: env ? mergeEnv(process.env, env) : process.env, timeout, maxBuffer, encoding, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: String(stderr || '') || (err ? err.message : '') });
      });
      c.stdin.on('error', () => {});
      c.stdin.end(input == null ? undefined : input);
    });
  },
  spawn(cmd, args, { cwd, env, stdin = null, keepOpen = false } = {}) { return start(cmd, args, { cwd, env: mergeEnv(process.env, env), stdin, keepOpen }); },
  kill(child) { killTree(child); },
  async info() { return { home: os.homedir(), tmp: os.tmpdir() }; },
  async readFile(p, { maxBytes } = {}) {
    if (!maxBytes) return fs.readFileSync(p);
    const fd = fs.openSync(p, 'r');
    try { const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, maxBytes)); const n = fs.readSync(fd, buf, 0, buf.length, 0); return buf.subarray(0, n); } finally { fs.closeSync(fd); }
  },
  // Creates missing parent folders.
  async writeFile(p, data, { mode } = {}) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); if (mode != null) fs.chmodSync(p, mode); },
  async mkdir(p) { fs.mkdirSync(p, { recursive: true }); },
  async rm(p) { fs.rmSync(p, { recursive: true, force: true }); },
  async mkdtemp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); },
  async realpath(p) { try { return fs.realpathSync(p); } catch { return p; } },
  async symlink(target, p) { fs.symlinkSync(target, p); },
  async chmod(p, mode) { fs.chmodSync(p, mode); },
  async exists(p) { try { fs.lstatSync(p); return true; } catch { return false; } },
  async stat(p) { try { const st = fs.statSync(p); return { size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory() }; } catch { return null; } },
  // path -> "mtime:size", or "deleted" when the path does not exist.
  async fingerprints(paths) {
    const m = new Map();
    for (const p of paths) { try { m.set(p, fingerprintOf(fs.statSync(p))); } catch { m.set(p, 'deleted'); } }
    return m;
  },
};

function sshHost(remote) {
  const r = ssh.checkRemote(remote);
  const options = ssh.sshOptions(r);
  const launch = (cmd, args, { cwd, env, pidFile }) => {
    const header = ssh.envHeader(env);
    const child = spawn('ssh', [...options, '-T', '--', r.target, ssh.remoteCommand(cmd, args, { cwd, pidFile })], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
    child.stdin.on('error', () => {});
    child.stdin.write(header);
    return child;
  };
  let info = null;

  const host = {
    remote: true,
    label: r.target,
    root: r.path,
    spec: r,
    path: path.posix,
    exec(cmd, args, { cwd, env, input, timeout = 0, maxBuffer = MAX_BUFFER, encoding = 'utf8' } = {}) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (res) => { if (!done) { done = true; resolve(res); } };
        const empty = encoding === 'buffer' ? Buffer.alloc(0) : '';
        let child;
        try { child = launch(cmd, args, { cwd, env }); } catch (e) { finish({ code: 1, stdout: empty, stderr: e.message }); return; }
        const out = []; const err = []; let size = 0; let failure = '';
        child.stdout.on('data', (d) => { size += d.length; if (size > maxBuffer) { failure = 'stdout maxBuffer length exceeded'; killTree(child); } else out.push(d); });
        child.stderr.on('data', (d) => err.push(d));
        const timer = timeout ? setTimeout(() => { failure = `Timed out after ${timeout} ms`; killTree(child); }, timeout) : null;
        child.on('error', (e) => { if (timer) clearTimeout(timer); finish({ code: 127, stdout: empty, stderr: e.code === 'ENOENT' ? 'ssh is not installed or not on PATH' : e.message }); });
        child.on('close', (code) => {
          if (timer) clearTimeout(timer);
          const buf = Buffer.concat(out); const stderr = Buffer.concat(err).toString('utf8');
          finish({ code: failure ? (code || 1) : (code == null ? 255 : code), stdout: encoding === 'buffer' ? buf : buf.toString('utf8'), stderr: failure ? `${stderr}${failure}` : stderr });
        });
        child.stdin.end(input == null ? undefined : input);
      });
    },
    spawn(cmd, args, { cwd, env, stdin = null, keepOpen = false } = {}) {
      const pidFile = `.cache/tributary/run/${crypto.randomBytes(8).toString('hex')}.pid`;
      const child = launch(cmd, args, { cwd, env, pidFile });
      child.tributaryPidFile = pidFile;
      if (stdin != null) child.stdin.end(stdin); else if (!keepOpen) child.stdin.end();
      return child;
    },
    // Stop the remote process group (closing ssh alone would leave it running on the host),
    // then the local ssh client. Like killTree: TERM first, KILL after 3 seconds.
    kill(child) {
      if (!child || child.tributaryStopping || child.exitCode !== null) return;
      child.tributaryStopping = true;
      const f = child.tributaryPidFile;
      const signal = (sig) => host.exec('sh', ['-c', ssh.killCommand(f, sig)], { timeout: 15000 });
      const cleanup = () => host.exec('rm', ['-f', '--', f, `${f}.cancel`], { timeout: 15000 });
      let closed = false;
      child.once('close', () => { closed = true; });
      signal('TERM').then(() => {
        if (closed) { cleanup(); return; }
        const t = setTimeout(async () => { await signal('KILL'); killTree(child); cleanup(); }, 3000);
        t.unref();
        child.once('close', () => { clearTimeout(t); cleanup(); });
      });
    },
    async info() {
      if (!info) {
        info = must(sh('printf "%s\\n%s\\n" "$HOME" "${TMPDIR:-/tmp}"')).then((res) => {
          const [home, tmp] = res.stdout.split('\n');
          return { home, tmp };
        });
        info.catch(() => { info = null; });
      }
      return info;
    },
    async readFile(p, { maxBytes } = {}) {
      const res = await sh(maxBytes ? 'head -c "$2" -- "$1"' : 'cat -- "$1"', [p, maxBytes || ''], { encoding: 'buffer' });
      if (res.code !== 0) throw fsError(res, p);
      return res.stdout;
    },
    async writeFile(p, data, { mode } = {}) {
      await must(sh(`mkdir -p -- "$(dirname -- "$1")" && cat > "$1"${mode != null ? ' && chmod "$2" "$1"' : ''}`, [p, mode != null ? mode.toString(8) : ''], { input: data }));
    },
    async mkdir(p) { await must(sh('mkdir -p -- "$1"', [p])); },
    async rm(p) { await must(sh('rm -rf -- "$1"', [p])); },
    async mkdtemp(prefix) { return (await must(sh('mktemp -d "${TMPDIR:-/tmp}/${1}XXXXXX"', [prefix]))).stdout.trim(); },
    async realpath(p) { const res = await sh('cd -P -- "$1" 2>/dev/null && pwd -P || realpath -- "$1"', [p]); return res.code === 0 ? res.stdout.trim() : p; },
    async symlink(target, p) { await must(sh('ln -s -- "$1" "$2"', [target, p])); },
    async chmod(p, mode) { await must(sh('chmod "$2" "$1"', [p, mode.toString(8)])); },
    async exists(p) { return (await sh('[ -e "$1" ] || [ -L "$1" ]', [p])).code === 0; },
    async stat(p) {
      const res = await sh('find "$1" -maxdepth 0 -printf "%s %T@ %y"', [p]);
      if (res.code !== 0 || !res.stdout) return null;
      const [size, mtime, type] = res.stdout.trim().split(' ');
      return { size: Number(size), mtimeMs: Math.round(Number(mtime) * 1e6) / 1e3, isDirectory: type === 'd' };
    },
    async fingerprints(paths) {
      const m = new Map(paths.map((p) => [p, 'deleted']));
      if (!paths.length) return m;
      const res = await sh('find "$@" -maxdepth 0 -printf "%p\\0%T@:%s\\0" 2>/dev/null; exit 0', paths);
      const parts = res.stdout.split('\0');
      for (let i = 0; i + 1 < parts.length; i += 2) if (m.has(parts[i])) m.set(parts[i], parts[i + 1]);
      return m;
    },
  };
  const sh = (script, params = [], o = {}) => host.exec('sh', ['-c', script, 'sh', ...params.map(String)], o);
  return host;
}

async function must(p) {
  const res = await p;
  if (res.code !== 0) throw new Error(String(res.stderr).trim() || `Remote command failed (exit ${res.code})`);
  return res;
}
function fsError(res, p) {
  const e = new Error(String(res.stderr).trim() || `Could not read ${p}`);
  if (/No such file/i.test(e.message)) e.code = 'ENOENT';
  return e;
}

// One host object per remote, so its cached details (home folder) are reused.
const hosts = new Map();
function hostFor(remote) {
  if (!remote || !remote.target) return localHost;
  const r = ssh.checkRemote(remote);
  const key = JSON.stringify([r.target, r.port, r.identityFile, r.path]);
  if (!hosts.has(key)) hosts.set(key, sshHost(r));
  return hosts.get(key);
}

// Open (or reuse) the shared connection. Resolves once the host answers; rejects with ssh's error.
async function connect(remote, { timeout = 30000 } = {}) {
  const res = await sshHost(remote).exec('true', [], { timeout });
  if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').filter(Boolean).pop() || `ssh exited with code ${res.code}`);
  return true;
}

// Close the shared connection.
function disconnect(remote) {
  return new Promise((resolve) => {
    const r = ssh.checkRemote(remote);
    execFile('ssh', [...ssh.sshOptions(r), '-O', 'exit', '--', r.target], { timeout: 10000 }, () => resolve());
  });
}

module.exports = { localHost, sshHost, hostFor, connect, disconnect, mergeEnv };
