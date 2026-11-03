'use strict';
// Run one of the project's own scripts (setup, verify) in a folder: through the shell, with the PATH agents get
// (an app started from the desktop menu has no nvm or Homebrew on PATH), extra env, a time limit and Stop.
// The whole process group is stopped, so `npm install` doesn't leave children behind. Keeps the last 6 KB.
const { spawn } = require('child_process');
const path = require('path');
const { pathDirs } = require('./agents');

/** -> { passed, code, output, ms, aborted?, timedOut? } */
function runScript(command, { cwd, env = {}, timeoutMs = 10 * 60 * 1000, signal } = {}) {
  const t0 = Date.now();
  if (signal?.aborted) return Promise.resolve({ passed: false, output: '[stopped]', aborted: true, ms: 0 });
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'cmd.exe' : '/bin/sh', win ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd, env: { ...process.env, PATH: pathDirs().join(path.delimiter), ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: !win, windowsHide: true,
    });
    let out = ''; const take = (d) => { out = (out + d).slice(-6000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    let aborted = false; let timedOut = false;
    const kill = () => { try { if (win) child.kill(); else process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
    const abort = () => { if (aborted) return; aborted = true; take('\n[stopped]'); kill(); };
    const timer = setTimeout(() => { timedOut = true; take('\n[timed out]'); kill(); }, timeoutMs);
    const finish = (r) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ ...r, ms: Date.now() - t0 }); };
    child.on('close', (code) => finish({ passed: code === 0 && !aborted && !timedOut, code, output: out, ...(aborted ? { aborted: true } : {}), ...(timedOut ? { timedOut: true } : {}) }));
    child.on('error', (e) => finish({ passed: false, output: e.message, ...(aborted ? { aborted: true } : {}) }));
    signal?.addEventListener('abort', abort, { once: true });
  });
}

module.exports = { runScript };
