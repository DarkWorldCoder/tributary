// File-location suffixes follow VS Code's extractRangeFromFilter convention.
// Only a caret location is supported here; selections/ranges are left literal.
export function quickOpenQuery(value) {
  const file = value.trim();
  const match = /^(.+?)(?::|#)(\d*)(?:[:,](\d*))?$/.exec(file);
  if (!match) return { file };
  const line = Number(match[2] || 1), column = Number(match[3] || 1);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return { file };
  return { file: match[1].trimEnd(), line: Math.max(1, line), column: Math.max(1, column) };
}
