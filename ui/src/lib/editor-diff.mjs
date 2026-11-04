import { diffRows } from '../../../core/diff-view.mjs';

// Anchor deleted lines to the next surviving line, including deletions at EOF.
export function editorDiffMarkers(diff) {
  const parsed = diffRows(diff);
  const markers = new Map(); let next = 1;
  for (const row of parsed.rows) {
    if (row.kind === 'hunk') { next = Math.max(1, Number(/\+(\d+)/.exec(row.text)?.[1] || 1)); continue; }
    if (row.kind === 'add' || row.kind === 'remove') {
      const line = row.kind === 'add' ? row.after : next;
      const marker = markers.get(line) || { line, added: 0, removed: 0 };
      marker[row.kind === 'add' ? 'added' : 'removed']++;
      markers.set(line, marker);
    }
    if (row.after != null) next = row.after + 1;
  }
  return [...markers.values()].sort((a, b) => a.line - b.line);
}

export function editorDiffStats(diff) {
  let added = 0; let removed = 0; let source = false; let binary = false;
  for (const line of String(diff || '').split('\n')) {
    if (/^Binary files |^GIT binary patch/.test(line)) binary = true;
    if (line.startsWith('diff --git ')) { source = false; continue; }
    if (line.startsWith('@@ ') || line.startsWith('new file ') && !line.startsWith('new file mode')) { source = true; continue; }
    if (!source) continue;
    if (line.startsWith('+')) added++; else if (line.startsWith('-')) removed++;
  }
  return binary ? { binary: true } : { added, removed };
}
