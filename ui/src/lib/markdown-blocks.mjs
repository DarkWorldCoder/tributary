// A long reply split into its top-level markdown blocks, so a streaming reply re-parses only the block being
// written. Plain JavaScript so node:test can check that rendering the blocks matches rendering the whole text.

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
// [label]: url and [^note]: text only resolve when the whole document is parsed together.
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:\s/m;

export function splitBlocks(text, min = 1500) {
  if (text.length < min || DEFINITION.test(text)) return [text];
  const blocks = [];
  let current = []; let blanks = 0; let fence = null; let list = false;
  for (const line of text.split('\n')) {
    if (fence) {
      current.push(line);
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.length && !m[2].trim()) fence = null;
      continue;
    }
    if (!line.trim()) { if (current.length) blanks++; continue; }
    if (blanks) {
      // After a blank line, indented lines and further list items still belong to the block before.
      const continues = /^[ \t]/.test(line) || (list && LIST_ITEM.test(line));
      if (continues) { for (; blanks; blanks--) current.push(''); }
      else { blocks.push(current.join('\n')); current = []; blanks = 0; list = false; }
    }
    if (!current.length) list = LIST_ITEM.test(line);
    current.push(line);
    const m = FENCE.exec(line);
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) fence = { char: m[1][0], length: m[1].length };
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks.length ? blocks : [text];
}
