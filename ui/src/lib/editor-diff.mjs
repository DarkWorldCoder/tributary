// Editor annotations need the complete supplied patch, not the bounded review UI.
// Scan line boundaries without materializing source lines, display rows or columns.
function scanDiff(input, withMarkers) {
  const text = String(input || ''); const markers = withMarkers ? new Map() : null;
  let next = 1, oldLeft = 0, newLeft = 0, untracked = false, added = 0, removed = 0, binary = false;
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start), end = newline < 0 ? text.length : newline;
    const prefix = text.charCodeAt(start);
    if (prefix === 64 && text.startsWith('@@ ', start)) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text.slice(start, Math.min(end, start + 160)));
      if (hunk) { next = Math.max(1, Number(hunk[3])); oldLeft = Number(hunk[2] ?? 1); newLeft = Number(hunk[4] ?? 1); untracked = false; }
    } else if (text.startsWith('diff --git ', start)) { oldLeft = newLeft = 0; untracked = false; }
    else if (text.startsWith('Binary files ', start) || text.startsWith('GIT binary patch', start) || text.startsWith('Binary file.', start)) { binary = true; oldLeft = newLeft = 0; untracked = false; }
    else if (!oldLeft && !newLeft && text.startsWith('new file ', start) && !text.startsWith('new file mode', start)) { next = 1; untracked = true; }
    else if (prefix === 43 && (newLeft > 0 || untracked) || prefix === 45 && oldLeft > 0) {
      const add = prefix === 43; const line = next;
      if (markers) { const marker = markers.get(line) || { line, added: 0, removed: 0 }; marker[add ? 'added' : 'removed']++; markers.set(line, marker); }
      if (add) { added++; next++; if (!untracked) newLeft--; } else { removed++; oldLeft--; }
    } else if (prefix === 32 && oldLeft > 0 && newLeft > 0) { next++; oldLeft--; newLeft--; }
    start = end + 1;
  }
  return { markers: binary || !markers ? [] : [...markers.values()].sort((a, b) => a.line - b.line), stats: binary ? { binary: true } : { added, removed } };
}

export function editorDiff(diff) { return scanDiff(diff, true); }
// Compatibility helpers share the scanner; stats-only callers allocate no markers.
export function editorDiffMarkers(diff) { return scanDiff(diff, true).markers; }
export function editorDiffStats(diff) { return scanDiff(diff, false).stats; }
