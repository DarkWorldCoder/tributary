// Adapted from Microsoft's MIT-licensed matchesContiguousSubString /
// matchesSubString in vscode/src/vs/base/common/filters.ts.
// Copyright (c) Microsoft Corporation. See assets/licenses/vscode-search-LICENSE.txt.
// This supplies display ranges only; existing command/file ranking remains in charge.
export function searchLabelRanges(text, query) {
  const needle = Array.from(query.trim(), (char) => char.toLowerCase());
  if (!needle.length) return [];
  // Keep original UTF-16 offsets when lowercase expands a character (e.g. İ)
  // or a character occupies a surrogate pair. Never slice inside that character.
  const chars = []; let offset = 0;
  for (const char of text) {
    chars.push({ value: char.toLowerCase(), start: offset, end: offset + char.length });
    offset += char.length;
  }
  if (needle.length > chars.length) return [];
  let positions = [];
  // Prefer the contiguous match, as VS Code's fuzzy filter does before its
  // subsequence fallback. Use iteration rather than recursive call-stack depth.
  for (let start = 0; start <= chars.length - needle.length; start++) {
    if (needle.every((char, index) => char === chars[start + index].value)) {
      positions = chars.slice(start, start + needle.length); break;
    }
  }
  if (!positions.length) {
    let index = 0;
    for (const char of chars) {
      if (char.value === needle[index]) { positions.push(char); if (++index === needle.length) break; }
    }
    if (index !== needle.length) return [];
  }
  const ranges = [];
  for (const { start, end } of positions) {
    const previous = ranges.at(-1);
    if (previous?.end === start) previous.end = end;
    else ranges.push({ start, end });
  }
  return ranges;
}
