export function applyLspEdits(text, edits) {
  if (!Array.isArray(edits) || edits.length > 5000) throw new Error('Invalid formatting response.');
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const offset = (position) => { if (!Number.isInteger(position?.line) || !Number.isInteger(position.character) || position.line < 0 || position.line >= starts.length || position.character < 0) throw new Error('Invalid formatting range.'); const start = starts[position.line]; const end = position.line + 1 < starts.length ? starts[position.line + 1] - 1 : text.length; if (start + position.character > end) throw new Error('Invalid formatting range.'); return start + position.character; };
  const changes = edits.map((edit) => { if (typeof edit.newText !== 'string') throw new Error('Invalid formatted text.'); const from = offset(edit.range?.start); const to = offset(edit.range?.end); if (to < from) throw new Error('Invalid formatting range.'); return { from, to, insert: edit.newText }; }).sort((a, b) => b.from - a.from || b.to - a.to);
  let previous = text.length; let result = text;
  for (const change of changes) { if (change.to > previous) throw new Error('Overlapping formatting edits.'); result = result.slice(0, change.from) + change.insert + result.slice(change.to); previous = change.from; }
  if (result.length > 2 * 1024 * 1024) throw new Error('Formatted text is too large.');
  return result;
}
