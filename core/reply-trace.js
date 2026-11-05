'use strict';

// Positions refer to the rendered reply, not the provider's raw stream. Tool
// updates keep their first position; thinking ranges refer to the bounded buffer.
function recordReplyActivity(msg, event, at = Date.now()) {
  const previous = msg.trace?.at(-1);
  if (previous?.kind === 'thinking' && previous.endedAt == null && ['text', 'tool', 'plan', 'permission', 'done', 'error'].includes(event.kind)) previous.endedAt = at;
  if (!['thinking', 'tool', 'plan', 'permission'].includes(event.kind)) return;
  const trace = msg.trace || (msg.trace = []);
  const textOffset = (msg.text || '').length;
  const last = trace.at(-1);
  if (event.kind === 'thinking') {
    if (!event.text) return;
    const start = msg.thinkingLength ?? (msg.thinking || '').length;
    msg.thinkingLength = start + event.text.length;
    if (last?.kind === 'thinking' && last.endedAt == null && last.textOffset === textOffset) last.end = msg.thinkingLength;
    else trace.push({ kind: 'thinking', textOffset, start, end: msg.thinkingLength, ts: at });
  } else if (event.kind === 'tool') {
    const existing = (msg.tools || []).findIndex((tool) => event.id != null && tool.id === event.id);
    const toolIndex = existing < 0 ? (msg.tools || []).length : existing;
    if (!trace.some((entry) => entry.kind === 'tool' && entry.toolIndex === toolIndex)) trace.push({ kind: 'tool', textOffset, toolIndex, ts: at });
  } else if (event.kind === 'plan') {
    const items = (event.items || []).map((item) => ({ ...item }));
    if (last?.kind === 'plan' && last.textOffset === textOffset) last.items = items;
    else trace.push({ kind: 'plan', textOffset, items, ts: at });
  } else trace.push({ kind: 'permission', textOffset, requestId: event.requestId, ts: at });
}

module.exports = { recordReplyActivity };
