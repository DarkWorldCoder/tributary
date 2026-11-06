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

// Reuse the previous canonical string and only materialize inserted Text, not
// every unchanged line in CodeMirror's tree. Joining multiple nonempty pieces
// produces a fresh sequential string in the pinned V8 runtime (array-join.tq),
// so an append/deletion cannot retain a chain of old complete snapshots.
export function textAfterChanges(before, changes) {
  if (before.length !== changes.length) throw new RangeError('Text does not match the change set.');
  if (changes.empty) return before;
  const pieces = []; let at = 0;
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (from > at) pieces.push(before.slice(at, from));
    const text = inserted.toString(); if (text) pieces.push(text);
    at = to;
  });
  if (at < before.length) pieces.push(before.slice(at));
  if (pieces.length === 1) {
    const only = pieces[0];
    return only.length < 2 ? String.fromCharCode(only.charCodeAt(0)) : [only.slice(0, 1), only.slice(1)].join('');
  }
  return pieces.join('');
}

// The lines of the new text (1-based) that a change covers, for highlighting what an agent just changed.
export function changedLines(after, change, fromLine) {
  let from = fromLine ?? 1;
  if (fromLine === undefined) for (let at = after.indexOf('\n'); at >= 0 && at < change.from; at = after.indexOf('\n', at + 1)) from++;
  let added = 0;
  for (let at = change.insert.indexOf('\n'); at >= 0; at = change.insert.indexOf('\n', at + 1)) added++;
  return { from, to: from + added - (change.insert.endsWith('\n') ? 1 : 0) };
}
