'use strict';
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const cancelled = () => Object.assign(Error('Native work cancelled'), { name: 'AbortError' });
let active = 0;
const queue = [];

// Every operation shares admission. A slot is released after its child closes.
function admission(signal) {
  if (signal?.aborted) return Promise.reject(cancelled());
  if (queue.length >= 64) return Promise.reject(Error('Too many searches are running. Wait for one to finish.'));
  return new Promise((resolve, reject) => {
    const item = { signal, resolve, reject, abort: null };
    item.abort = () => { const at = queue.indexOf(item); if (at >= 0) { queue.splice(at, 1); reject(cancelled()); } };
    signal?.addEventListener('abort', item.abort, { once: true });
    queue.push(item); pump();
  });
}
function pump() {
  while (active < 2 && queue.length) {
    const item = queue.shift(); item.signal?.removeEventListener('abort', item.abort);
    if (item.signal?.aborted) { item.reject(cancelled()); continue; }
    active++; let released = false;
    item.resolve(() => { if (!released) { released = true; active--; pump(); } });
  }
}
async function engineRequest(binary, args, { signal, record, finish, dispose }) {
  let release;
  try {
    if (signal?.aborted) throw cancelled();
    if (!Array.isArray(args) || !args.length || args.length > 16) return null;
    let argumentBytes = 0;
    for (const arg of args) {
      if (typeof arg !== 'string' || arg.includes('\0') || (argumentBytes += Buffer.byteLength(arg)) > 64 * 1024) return null;
    }
    release = await admission(signal);
    if (signal?.aborted) throw cancelled();
    return await receive(binary, args, signal, record, finish);
  } finally { release?.(); dispose?.(); }
}
function receive(binary, args, signal, record, finish) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch { resolve(null); return; }
    let blocks = [], pieces = [], partial = 0, length = 0, failed = false, killTimer;
    const decoder = new StringDecoder('utf8');
    const clear = () => { blocks = []; pieces = []; partial = 0; };
    const stop = () => {
      if (failed) return;
      failed = true; clear(); child.kill();
      // Cancellation owns the actual process lifetime, including a worker that
      // does not cooperate with the first termination request.
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250); killTimer.unref();
    };
    const append = text => {
      if (!text) return;
      partial += text.length; if (partial > 256 * 1024) throw Error();
      pieces.push(text);
      if (pieces.length === 64) { blocks.push(pieces.join('')); pieces = []; }
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.on('error', stop); child.stdout.on('error', stop); child.stdin.on('error', stop);
    child.stdout.on('data', bytes => {
      length += bytes.length;
      if (failed) return;
      if (length > 4 * 1024 ** 2) { stop(); return; }
      const text = decoder.write(bytes);
      try {
        let start = 0, end;
        // Search only new input; join each fragmented record once.
        while ((end = text.indexOf('\n', start)) !== -1) {
          const part = text.slice(start, end); start = end + 1;
          if (partial) { append(part); const line = [...blocks, ...pieces].join(''); clear(); record(JSON.parse(line)); }
          else { if (part.length > 256 * 1024) throw Error(); record(JSON.parse(part)); }
        }
        append(text.slice(start));
      } catch { stop(); }
    });
    child.on('close', code => {
      clearTimeout(killTimer); child.stdin.destroy();
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) { clear(); reject(cancelled()); return; }
      if (failed || code !== 0) { clear(); resolve(null); return; }
      try { if (decoder.end() || partial) throw Error(); resolve(finish()); }
      catch { resolve(null); }
      finally { clear(); }
    });
  });
}
module.exports = { engineRequest };
