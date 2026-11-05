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

// Search only new input for delimiters. Repeatedly searching/flattening an ever
// growing partial JSON frame makes fragmented long replies quadratic.
function lines(stream, onLine) {
  let blocks = []; let pieces = []; let disposed = false;
  const append = (piece) => {
    if (!piece) return;
    pieces.push(piece);
    // Tiny transport chunks should not require one retained array slot each.
    if (pieces.length === 64) { blocks.push(pieces.join('')); pieces = []; }
  };
  const take = (last = '') => {
    if (!blocks.length && !pieces.length) return last;
    append(last);
    const line = blocks.length ? [...blocks, ...pieces].join('') : pieces.join('');
    blocks = []; pieces = [];
    return line;
  };
  const data = (chunk) => {
    let start = 0; let end;
    while (!disposed && (end = chunk.indexOf('\n', start)) >= 0) {
      const line = blocks.length || pieces.length ? take(chunk.slice(start, end)) : chunk.slice(start, end); start = end + 1;
      onLine(line);
    }
    if (!disposed) append(chunk.slice(start));
  };
  const dispose = () => { disposed = true; blocks = []; pieces = []; stream.off('data', data); stream.off('end', end); stream.off('close', dispose); };
  const end = () => { const final = take(); dispose(); if (final) onLine(final); };
  stream.setEncoding('utf8');
  stream.on('data', data); stream.once('end', end); stream.once('close', dispose);
  return dispose;
}

// Diagnostics need a tail, not complete protocol frames. A newline-free error
// stream must not accumulate in the line framer before this bound is applied.
function streamTail(stream, limit, onTail) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid stream tail limit');
  let tail = '';
  const data = (chunk) => { tail = (tail + chunk.slice(-limit)).slice(-limit); onTail(tail); };
  const dispose = () => { tail = ''; stream.off('data', data); stream.off('end', dispose); stream.off('close', dispose); };
  stream.setEncoding('utf8');
  stream.on('data', data); stream.once('end', dispose); stream.once('close', dispose);
  return dispose;
}

module.exports = { start, killTree, lines, streamTail };
