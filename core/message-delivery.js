'use strict';
const { createPatcher } = require('./message-patch');
// Coalescing timers and asynchronous webview delivery own their live messages
// independently of the operation that emitted them.
function bindMessageDelivery(hub, deliver, ms = 80) {
  const pending = new Map(); let patcher = createPatcher();
  const keyOf = (threadId, message) => `${threadId}\0${message.id}`;
  const send = (name, data, release) => {
    let result;
    try { result = deliver(name, data); }
    catch (error) { release(); throw error; }
    if (result && typeof result.then === 'function') Promise.resolve(result).then(release, (error) => { release(); console.error(`Could not deliver chat update: ${error.message}`); });
    else release();
  };
  const event = ({ threadId, message }) => {
    const key = keyOf(threadId, message);
    if (pending.has(key)) { pending.get(key).message = message; return; }
    const release = hub.holdHistory(threadId);
    const entry = { message, release, timer: null };
    entry.timer = setTimeout(() => {
      pending.delete(key);
      try {
        const patch = patcher.patch(entry.message);
        if (!patch) { patcher.full(entry.message); send('message', { threadId, message: entry.message }, release); }
        else if (Object.keys(patch).length) send('message-patch', { threadId, id: entry.message.id, patch }, release);
        else release();
      } catch (error) { release(); throw error; }
    }, ms);
    pending.set(key, entry);
  };
  const full = (data) => {
    const key = keyOf(data.threadId, data.message); const entry = pending.get(key);
    if (entry) { clearTimeout(entry.timer); pending.delete(key); }
    const release = entry?.release || hub.holdHistory(data.threadId);
    try { patcher.full(data.message); send('message', data, release); }
    catch (error) { release(); throw error; }
  };
  hub.on('event', event); hub.on('message', full);
  return () => {
    hub.off('event', event); hub.off('message', full);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.release(); }
    pending.clear(); patcher = null;
  };
}
module.exports = { bindMessageDelivery };
