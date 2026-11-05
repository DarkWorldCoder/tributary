'use strict';
// Count UTF-16 code units, matching node-pty strings and renderer write frames.
// This is a transport window, not a total RAM or native-PTY buffering budget.
const HIGH = 128 * 1024; const LOW = 32 * 1024; const FRAME = 16 * 1024;
function terminalOutput({ send, pause, resume, drained }, { high = HIGH, low = LOW, frame = FRAME, delay = 8, maxFrames = 128 } = {}) {
  if (![high, low, frame, delay, maxFrames].every(Number.isSafeInteger) || high < 1 || low < 0 || low >= high || frame < 1 || frame > high || delay < 0 || maxFrames < 1) throw new RangeError('Invalid terminal output limits');
  let owner = null; let paused = false; let disposed = false; let ended = false; let pumping = false; let timer = null;
  let parts = []; let head = 0; let offset = 0; let queued = 0; let outstanding = 0; let sequence = 0; let lastAck = 0;
  const sent = new Map();
  const setPaused = (value) => { if (paused !== value) { paused = value; if (!ended) (value ? pause : resume)(); } };
  const pressure = () => {
    if (disposed) return;
    if (!owner || queued + outstanding >= high || sent.size >= maxFrames) setPaused(true);
    else if (queued + outstanding <= low && sent.size <= Math.floor(maxFrames / 4)) setPaused(false);
  };
  const clearTimer = () => { if (timer != null) clearTimeout(timer); timer = null; };
  const take = (length) => {
    const chunks = []; let left = length;
    while (left) {
      const part = parts[head]; const n = Math.min(left, part.length - offset);
      chunks.push(part.slice(offset, offset + n)); offset += n; left -= n;
      if (offset === part.length) { parts[head++] = null; offset = 0; }
    }
    queued -= length;
    if (head === parts.length) { parts = []; head = 0; }
    else if (head >= 64) { parts = parts.slice(head); head = 0; }
    return chunks.length === 1 ? chunks[0] : chunks.join('');
  };
  const finish = () => { if (!disposed && ended && owner && !queued && !outstanding && !pumping) { dispose(); drained(); } };
  const flush = () => {
    clearTimer(); if (disposed || pumping || !owner) return;
    pumping = true;
    try {
      while (!disposed && owner && queued && outstanding < high && sent.size < maxFrames) {
        const data = take(Math.min(frame, queued, high - outstanding));
        const packet = { seq: ++sequence, data }; sent.set(packet.seq, packet); outstanding += data.length;
        send({ ...packet, owner });
      }
    } finally { pumping = false; }
    pressure(); finish();
  };
  const dispose = () => { if (disposed) return; disposed = true; clearTimer(); owner = null; parts = []; head = offset = queued = outstanding = 0; sent.clear(); };
  const push = (data) => {
    if (disposed || ended || !data) return;
    parts.push(data); queued += data.length; pressure();
    if (queued >= frame) flush(); else if (owner && timer == null) timer = setTimeout(flush, delay);
  };
  const attach = (next) => {
    if (disposed || typeof next !== 'string' || !/^[\w-]{1,128}$/.test(next)) return false;
    if (owner === next) return true;
    owner = next;
    // Replayed frames must precede new ones, even with synchronous test ACKs.
    const wasPumping = pumping; pumping = true;
    try { for (const packet of [...sent.values()]) { if (disposed || owner !== next) break; send({ ...packet, owner: next }); } }
    finally { pumping = wasPumping; }
    if (!pumping) flush(); pressure(); finish(); return true;
  };
  const detach = (current) => { if (!disposed && owner === current) { owner = null; clearTimer(); pressure(); return true; } return false; };
  const ack = (current, seq) => {
    if (disposed || owner !== current || !Number.isSafeInteger(seq) || seq <= lastAck || seq > sequence) return false;
    for (const [key, packet] of sent) { if (key > seq) break; outstanding -= packet.data.length; sent.delete(key); }
    lastAck = seq; flush(); pressure(); finish(); return true;
  };
  setPaused(true);
  return { push, attach, detach, ack, dispose,
    detachAll() { if (owner) detach(owner); },
    end() { if (disposed) return; ended = true; flush(); finish(); },
    stats: () => ({ queued, outstanding, retained: queued + outstanding, frames: sent.size, paused, owner, ended, disposed, timer: timer != null }),
  };
}
module.exports = { terminalOutput, HIGH, LOW, FRAME };
