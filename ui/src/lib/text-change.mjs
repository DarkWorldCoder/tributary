// The smallest single replacement that turns one text into another. The common start and end stay as they are, so
// an editor that applies it keeps the cursor, selection, scroll position and folds outside the changed part.
// Plain JavaScript so node:test can check it without a build step.
export function minimalChange(before, after) {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length; let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) { endBefore--; endAfter--; }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

// The lines of the new text (1-based) that a change covers, for highlighting what an agent just changed.
export function changedLines(after, change) {
  const from = after.slice(0, change.from).split('\n').length;
  return { from, to: from + change.insert.replace(/\n$/, '').split('\n').length - 1 };
}
