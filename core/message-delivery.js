'use strict';
const { createPatcher } = require('./message-patch');
// A replaced consumer asks for a complete replay once its next page is ready.
const RETRY_DELIVERY = Symbol('retry-message-delivery');
// Coalescing timers and asynchronous webview delivery own their live messages
// independently of the operation that emitted them.
function bindMessageDelivery(hub, deliver, ms = 80) {
  const pending = new Map(); const inFlight = new Set(); let patcher = createPatcher(); let closed = false;
  const report = error => console.error(`Could not deliver chat update: ${String(error?.message || error)}`);
  const keyOf = (threadId, message) => `${threadId}\0${message.id}`;
  const send = (key, name, data, release, source) => {
    let result; let settled = false;
    inFlight.add(key);
    const finish = (failed, retry = false) => {
      if (settled) return;
      settled = true;
      if (failed) patcher?.forget(data.message?.id || data.id);
      if (retry && !closed) {
        const latest = pending.get(key);
        // Acquire replacement ownership before releasing the interrupted send.
        enqueue(latest ? { ...(latest.full || {}), threadId: latest.threadId, message: latest.message } : source, true);
      }
      inFlight.delete(key); release();
      const next = pending.get(key);
      if (!closed && next?.ready) {
        try { flush(key, next); } catch (error) { report(error); }
      }
    };
    try { result = deliver(name, data); }
    catch (error) { finish(true); throw error; }
    try {
      if (result && typeof result.then === 'function') Promise.resolve(result).then((delivered) => finish(delivered === false || delivered === RETRY_DELIVERY, delivered === RETRY_DELIVERY), (error) => { finish(true); report(error); });
      else finish(result === false);
    } catch (error) { finish(true); throw error; }
  };
  const flush = (key, entry) => {
    if (closed || inFlight.has(key) || pending.get(key) !== entry) return;
    pending.delete(key); clearTimeout(entry.timer);
    const source = entry.full || { threadId: entry.threadId, message: entry.message };
    try {
      if (entry.full) { patcher.full(entry.message); send(key, 'message', entry.full, entry.release, source); return; }
      const patch = patcher.patch(entry.message);
      if (!patch) { patcher.full(entry.message); send(key, 'message', source, entry.release, source); }
      else if (Object.keys(patch).length) send(key, 'message-patch', { threadId: entry.threadId, id: entry.message.id, patch }, entry.release, source);
      else entry.release();
    } catch (error) { entry.release(); throw error; }
  };
  const enqueue = (data, full) => {
    if (closed) return;
    const { threadId, message } = data; const key = keyOf(threadId, message);
    let entry = pending.get(key);
    if (!entry) {
      const release = hub.holdHistory(threadId); let held = true;
      entry = { threadId, message, release: () => { if (held) { held = false; release(); } }, timer: null, ready: false, full: null };
      pending.set(key, entry);
    }
    entry.message = message;
    if (entry.full) entry.full = { ...entry.full, message };
    if (full) {
      entry.full = data; entry.ready = true; clearTimeout(entry.timer); entry.timer = null; flush(key, entry);
    } else if (!entry.ready && !entry.timer) {
      entry.timer = setTimeout(() => { entry.timer = null; entry.ready = true; flush(key, entry); }, ms);
    }
  };
  const event = data => enqueue(data, false);
  const full = data => enqueue(data, true);
  hub.on('event', event); hub.on('message', full);
  const dispose = () => {
    if (closed) return;
    closed = true;
    hub.off('event', event); hub.off('message', full);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.release(); }
    pending.clear(); inFlight.clear(); patcher = null;
  };
  dispose.reset = () => { if (!closed) patcher = createPatcher(); };
  return dispose;
}
module.exports = { bindMessageDelivery, RETRY_DELIVERY };
