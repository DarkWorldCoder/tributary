'use strict';
// While a reply streams, the window gets what changed instead of the whole message every 80 ms: the new end of
// the text and thinking, the tools that changed, and any other field that changed. ui/src/lib/message-patch.mjs
// applies it. A message the window has not seen yet, or one that finished, is sent whole.

const GROWING = ['text', 'thinking'];

function snapshot(m) {
  const fields = {};
  for (const [k, v] of Object.entries(m)) if (k !== 'tools' && !GROWING.includes(k)) fields[k] = JSON.stringify(v);
  return { text: m.text || '', thinking: m.thinking || '', tools: (m.tools || []).map((t) => JSON.stringify(t)), fields };
}

function createPatcher() {
  const sent = new Map(); // message id -> what the window has
  return {
    // The whole message was sent. Keep track of it while it can still change.
    full(m) { if (m.ok == null) sent.set(m.id, snapshot(m)); else sent.delete(m.id); },
    // What changed since the last send ({} when nothing did), or null when the message should be sent whole.
    patch(m) {
      const prev = sent.get(m.id);
      if (!prev) return null;
      const next = snapshot(m); const p = {};
      for (const k of GROWING) {
        const a = prev[k]; const b = next[k];
        // Thinking keeps only its last 20,000 characters, so it does not always grow at the end.
        if (a !== b) p[k] = b.startsWith(a) ? { from: a.length, add: b.slice(a.length) } : { from: 0, add: b };
      }
      const set = {};
      next.tools.forEach((t, i) => { if (prev.tools[i] !== t) set[i] = m.tools[i]; });
      if (Object.keys(set).length || next.tools.length !== prev.tools.length) p.tools = { length: next.tools.length, set };
      const fields = {};
      for (const [k, v] of Object.entries(next.fields)) if (prev.fields[k] !== v) fields[k] = m[k];
      if (Object.keys(fields).length) p.set = fields;
      const unset = Object.keys(prev.fields).filter((k) => !(k in next.fields));
      if (unset.length) p.unset = unset;
      if (m.ok != null) sent.delete(m.id); else sent.set(m.id, next);
      return p;
    },
  };
}

module.exports = { createPatcher };
