'use strict';
// Spawn an agent process safely (no shell) and kill its whole process tree on stop.
const { spawn, execFile } = require('child_process');

function start(command, args, { cwd, env, stdin, keepOpen = false }) {
  const child = spawn(command, args, {
    cwd, env, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', // own process group so we can kill tools it started
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {}); // agent exited before reading all input
  if (stdin != null) child.stdin.end(stdin); else if (!keepOpen) child.stdin.end();
  return child;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
  t.unref();
}

// Split a stream into lines, calling onLine for each complete line.
function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  stream.on('end', () => { if (buf) onLine(buf); buf = ''; });
}

module.exports = { start, killTree, lines };
