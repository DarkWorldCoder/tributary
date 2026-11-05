'use strict';
// While a reply streams, the window gets what changed instead of the whole message every 80 ms: the new end of
// the text and thinking, the tools that changed, and any other field that changed. ui/src/lib/message-patch.mjs
// applies it. A message the window has not seen yet, or one that finished, is sent whole.

const GROWING = ['text', 'thinking'];
const ARRAYS = ['tools', 'trace'];

function snapshot(m) {
  const fields = {};
  for (const [k, v] of Object.entries(m)) if (!ARRAYS.includes(k) && !GROWING.includes(k)) fields[k] = JSON.stringify(v);
  return { present: ARRAYS.filter((key) => key in m), text: m.text || '', thinking: m.thinking || '', arrays: Object.fromEntries(ARRAYS.map((key) => [key, (m[key] || []).map((item) => JSON.stringify(item))])), fields };
}

function createPatcher() {
  const sent = new Map(); // message id -> what the window has
  return {
    // The whole message was sent. Keep track of it while it can still change.
    full(m) { if (m.ok == null && m.role !== 'user' && m.role !== 'system') sent.set(m.id, snapshot(m)); else sent.delete(m.id); },
    forget(id) { sent.delete(id); },
    // What changed since the last send ({} when nothing did), or null when the message should be sent whole.
    patch(m) {
      if (m.role === 'user' || m.role === 'system') { sent.delete(m.id); return null; }
      const prev = sent.get(m.id);
      if (!prev) return null;
      const next = snapshot(m); const p = {};
      for (const k of GROWING) {
        const a = prev[k]; const b = next[k];
        // Thinking keeps only its last 20,000 characters, so it does not always grow at the end.
        if (a !== b) p[k] = b.startsWith(a) ? { from: a.length, add: b.slice(a.length) } : { from: 0, add: b };
      }
      for (const key of ARRAYS) {
        if (!next.present.includes(key)) continue;
        const set = {};
        next.arrays[key].forEach((item, i) => { if (prev.arrays[key][i] !== item) set[i] = m[key][i]; });
        if (!prev.present.includes(key) || Object.keys(set).length || next.arrays[key].length !== prev.arrays[key].length) p[key] = { length: next.arrays[key].length, set };
      }
      const fields = {};
      for (const [k, v] of Object.entries(next.fields)) if (prev.fields[k] !== v) fields[k] = m[k];
      if (Object.keys(fields).length) p.set = fields;
      const unset = [...Object.keys(prev.fields).filter((k) => !(k in next.fields)), ...prev.present.filter((key) => !next.present.includes(key))];
      if (unset.length) p.unset = unset;
      if (m.ok != null) sent.delete(m.id); else sent.set(m.id, next);
      return p;
    },
  };
}

module.exports = { createPatcher };
