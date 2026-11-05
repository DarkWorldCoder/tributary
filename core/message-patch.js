'use strict';
// While a reply streams, the window gets what changed instead of the whole message every 80 ms: the new end of
// the text and thinking, the tools that changed, and any other field that changed. ui/src/lib/message-patch.mjs
// applies it. A message the window has not seen yet, or one that finished, is sent whole.

const GROWING = ['text', 'thinking'];
const ARRAYS = ['tools', 'trace'];
const MAX_BASES = 64;
const MAX_BASE_BYTES = 8 * 1024 * 1024;
const { createHash } = require('node:crypto');
const { isProxy } = require('node:util').types;
// Large tool/metadata JSON is needed for equality, never for reconstructing a
// patch. Keep a fixed SHA-256 signature instead of a second long-lived copy.
// A literal NUL cannot begin JSON, so signatures cannot equal serialized JSON.
function comparison(value) {
  const json = JSON.stringify(value);
  return json?.length > 4096 ? `\0${json.length}:${createHash('sha256').update(json, 'utf16le').digest('base64')}` : json;
}

// Only specialize inert JSON data. Accessors, custom serialization, proxies,
// unfamiliar prototypes and expensive/cyclic metadata keep the generic path.
function plainData(value, budget) {
  if (--budget.left < 0) return false;
  const type = typeof value;
  if (value === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'undefined') return true;
  if (type !== 'object' || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== null && prototype !== Object.prototype && !(Array.isArray(value) && prototype === Array.prototype)) || 'toJSON' in value) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (value.length > budget.left) return false;
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(descriptors, i)) return false;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor) || !plainData(descriptor.value, budget)) return false;
  }
  return true;
}

function toolComparison(tool) {
  if (!tool || typeof tool !== 'object' || isProxy(tool)) return comparison(tool);
  const prototype = Object.getPrototypeOf(tool);
  if ((prototype !== null && prototype !== Object.prototype) || 'toJSON' in tool) return comparison(tool);
  const descriptors = Object.getOwnPropertyDescriptors(tool), output = descriptors.output;
  if (!output?.enumerable || typeof output.value !== 'string' || output.value.length <= 4096) return comparison(tool);
  const metadata = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) return comparison(tool);
    if (key !== 'output' && descriptor.enumerable) metadata[key] = descriptor.value;
  }
  if (!plainData(metadata, { left: 128 })) return comparison(tool);
  // JSON metadata cannot contain a literal NUL. Its terminator separates it
  // unambiguously from the raw UTF-16 output; neither long string is retained.
  return `\0o:${output.value.length}:${createHash('sha256').update(JSON.stringify(metadata), 'utf16le').update('\0', 'utf16le').update(output.value, 'utf16le').digest('base64')}`;
}

function snapshot(m) {
  const fields = {};
  for (const [k, v] of Object.entries(m)) if (!ARRAYS.includes(k) && !GROWING.includes(k)) fields[k] = comparison(v);
  return { present: ARRAYS.filter((key) => key in m), text: m.text || '', thinking: m.thinking || '', arrays: Object.fromEntries(ARRAYS.map((key) => [key, (m[key] || []).map(key === 'tools' ? toolComparison : comparison)])), fields };
}

// A comparison base is disposable: a cache miss sends the complete live message.
// Account two bytes per string code unit plus fixed structural costs. This is a
// cache policy weight, not a V8 heap measurement (strings can share storage).
function baseBytes(base, id) {
  const stringBytes = value => typeof value === 'string' ? value.length * 2 : 0;
  let bytes = 128 + stringBytes(id) + stringBytes(base.text) + stringBytes(base.thinking);
  for (const key of ARRAYS) for (const item of base.arrays[key]) bytes += 32 + stringBytes(item);
  for (const [key, value] of Object.entries(base.fields)) bytes += 32 + stringBytes(key) + stringBytes(value);
  return bytes;
}

function createPatcher({ maxEntries = MAX_BASES, maxBytes = MAX_BASE_BYTES } = {}) {
  for (const value of [maxEntries, maxBytes]) if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Patch cache limits must be non-negative integers.');
  const sent = new Map(); // message id -> what the window has
  let bytes = 0;
  const forget = id => { const old = sent.get(id); if (old) { bytes -= old.bytes; sent.delete(id); } };
  const remember = (id, base) => {
    forget(id);
    const size = baseBytes(base, id);
    if (!maxEntries || size > maxBytes) return;
    while (sent.size >= maxEntries || bytes + size > maxBytes) forget(sent.keys().next().value);
    sent.set(id, { base, bytes: size }); bytes += size;
  };
  return {
    // The whole message was sent. Keep track of it while it can still change.
    full(m) { if (m.ok == null && m.role !== 'user' && m.role !== 'system') remember(m.id, snapshot(m)); else forget(m.id); },
    forget,
    stats() { return { entries: sent.size, accountedBytes: bytes, maxEntries, maxBytes }; },
    // What changed since the last send ({} when nothing did), or null when the message should be sent whole.
    patch(m) {
      if (m.role === 'user' || m.role === 'system') { forget(m.id); return null; }
      const prev = sent.get(m.id)?.base;
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
      if (m.ok != null) forget(m.id); else remember(m.id, next);
      return p;
    },
  };
}

module.exports = { createPatcher };
