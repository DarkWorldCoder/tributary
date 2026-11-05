'use strict';
const { randomUUID } = require('node:crypto');
const { RETRY_DELIVERY } = require('../core/message-delivery');
const ownsMessageFrame = (event, contents) => !!contents && !contents.isDestroyed() && event.sender === contents && !!event.senderFrame && event.senderFrame === contents.mainFrame;

// This transport owns acknowledgement metadata, not another copy of each reply.
// bindMessageDelivery owns one active send and one latest pending state per reply.
function createMessageTransport({ send, onReady = () => {} }) {
  let epoch = randomUUID(), sequence = 0, ready = false, closed = false;
  const active = new Map(); const interrupted = new Set();
  const suspend = () => {
    ready = false;
    for (const resolve of active.values()) interrupted.add(resolve);
    active.clear();
  };
  return {
    deliver(name, data) {
      if (closed) return false;
      return new Promise(resolve => {
        if (!ready) { interrupted.add(resolve); return; }
        const id = ++sequence;
        active.set(id, resolve);
        try { send('hub-message', name, data, { epoch, id }); }
        catch { active.delete(id); resolve(false); }
      });
    },
    handshake() { if (!closed) send('hub-message-handshake', epoch); },
    ready(value, listening = true) {
      if (closed || value !== epoch || typeof listening !== 'boolean') return;
      if (!listening) { suspend(); return; }
      if (ready) return;
      ready = true;
      // Old deltas cannot be used by a new renderer. Clear bases before replay.
      onReady();
      const waiting = [...interrupted]; interrupted.clear();
      for (const resolve of waiting) resolve(RETRY_DELIVERY);
    },
    ack(token, consumed) {
      if (closed || !ready || !token || token.epoch !== epoch || !Number.isSafeInteger(token.id)) return;
      const resolve = active.get(token.id); if (!resolve) return;
      active.delete(token.id); resolve(consumed === true);
    },
    reset() { if (!closed) { suspend(); epoch = randomUUID(); } },
    close() {
      if (closed) return;
      closed = true; ready = false;
      for (const resolve of active.values()) resolve(false);
      for (const resolve of interrupted) resolve(false);
      active.clear(); interrupted.clear();
    },
    state: () => ({ epoch, ready, closed, active: active.size, interrupted: interrupted.size }),
  };
}
module.exports = { createMessageTransport, ownsMessageFrame };
