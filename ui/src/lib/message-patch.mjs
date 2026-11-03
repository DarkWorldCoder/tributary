// Applies a patch from core/message-patch.js to the window's copy of a streaming message. Returns null when the
// copy is missing text the patch builds on; the whole message arrives when the turn ends.
export function applyPatch(message, patch) {
  const out = { ...message };
  for (const k of ['text', 'thinking']) {
    const p = patch[k]; if (!p) continue;
    const current = out[k] || '';
    if (p.from > current.length) return null;
    out[k] = current.slice(0, p.from) + p.add;
  }
  if (patch.tools) {
    const tools = (out.tools || []).slice(0, patch.tools.length);
    for (const [i, t] of Object.entries(patch.tools.set)) tools[Number(i)] = t;
    out.tools = tools;
  }
  if (patch.set) Object.assign(out, patch.set);
  for (const k of patch.unset || []) delete out[k];
  return out;
}
