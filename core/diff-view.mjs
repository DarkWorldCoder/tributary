// Shared, bounded diff presentation. Text stays text; callers render it through React.
export function diffRows(input, limit = 2000) {
  const lines = String(input || '').split('\n', limit + 1); const truncated = lines.length > limit;
  let before = 1; let after = 1;
  const rows = lines.slice(0, limit).map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { before = Number(hunk[1]); after = Number(hunk[2]); return { kind: 'hunk', text: line }; }
    if (/^(diff |index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity |rename |Binary )/.test(line) || line.startsWith('\\')) return { kind: 'meta', text: line };
    if (line.startsWith('+')) return { kind: 'add', text: line.slice(1), after: after++ };
    if (line.startsWith('-')) return { kind: 'remove', text: line.slice(1), before: before++ };
    if (line.startsWith(' ')) return { kind: 'context', text: line.slice(1), before: before++, after: after++ };
    return { kind: 'meta', text: line };
  });
  const split = []; let removed = []; let added = [];
  const flush = () => { for (let i = 0; i < Math.max(removed.length, added.length); i++) split.push({ left: removed[i], right: added[i] }); removed = []; added = []; };
  for (const row of rows) {
    if (row.kind === 'remove') removed.push(row);
    else if (row.kind === 'add') added.push(row);
    else { flush(); split.push({ left: row, right: row }); }
  }
  flush();
  return { rows, split, truncated, added: rows.filter((r) => r.kind === 'add').length, removed: rows.filter((r) => r.kind === 'remove').length };
}
