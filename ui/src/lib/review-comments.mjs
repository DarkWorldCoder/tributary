// Comments on diff lines, sent to an agent as one message: where (an @path:line it can open), the line as it
// reads, and what to do about it. Grouped by file in line order, so the agent can work down the files.
const MAX_QUOTE = 160;

export function commentsMessage(comments) {
  if (!comments.length) return '';
  const sorted = [...comments].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const items = sorted.map((c, i) => {
    const quote = c.quote.length > MAX_QUOTE ? `${c.quote.slice(0, MAX_QUOTE)}…` : c.quote;
    const note = c.note.trim().split('\n').map((l) => `   ${l}`);
    if (c.by) note[0] = `   (from ${c.by}'s review) ${note[0].trimStart()}`;
    return [`${i + 1}. @${c.file}:${c.line}${c.side === 'before' ? ' (removed line)' : ''}`, ...(quote ? [`   > ${quote}`] : []), ...note].join('\n');
  });
  return ['Please address these review comments on your changes:', '', items.join('\n\n')].join('\n');
}
