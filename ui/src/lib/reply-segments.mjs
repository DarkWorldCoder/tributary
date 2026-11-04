// Preserve event positions while text and tool results stream independently.
// Older requests without a position stay after the text, as before.
export function replySegments(text, requests = [], trace = []) {
  const parts = []; let cursor = 0;
  const offsetOf = (entry) => Number.isSafeInteger(entry.textOffset) ? Math.max(0, Math.min(text.length, entry.textOffset)) : text.length;
  const byId = new Map(requests.map((request) => [request.id, request]));
  const positioned = new Set();
  const ordered = trace.flatMap((entry, index) => {
    if (entry.kind !== 'permission') return [{ entry, index, offset: offsetOf(entry) }];
    const request = byId.get(entry.requestId);
    if (!request || positioned.has(request.id)) return [];
    positioned.add(request.id);
    return [{ request, index, offset: offsetOf(entry) }];
  });
  requests.forEach((request, index) => {
    if (!positioned.has(request.id)) ordered.push({ request, index: trace.length + index, offset: offsetOf(request) });
  });
  ordered.sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (const { entry, request, offset, index } of ordered) {
    if (offset > cursor) parts.push({ kind: 'text', text: text.slice(cursor, offset) });
    if (request) parts.push({ kind: 'permission', request });
    else {
      const last = parts.at(-1);
      if (last?.kind === 'activity' && offset === cursor) last.entries.push(entry);
      else parts.push({ kind: 'activity', id: `activity:${index}`, entries: [entry] });
    }
    cursor = offset;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

export function thinkingExcerpt(message, entry) {
  const buffer = message.thinking || '';
  const base = (message.thinkingLength ?? buffer.length) - buffer.length;
  return buffer.slice(Math.max(0, entry.start - base), Math.max(0, entry.end - base));
}
