import { splitBlocks } from './markdown-blocks.mjs';

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:\s/m;
// A completed line's terminating LF also satisfies the legacy \s rule.
const COMPLETE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:(?:\s|$)/m;
export const MARKDOWN_GROUP_SIZE = 64;

const fresh = () => ({ blocks: [], pieces: [], blanks: 0, list: false, fence: null, start: 0, scan: 0, whole: false });
const at = (view, index) => index < view.count ? view.complete[index] : view.tail[index - view.count];
function own(value, source) {
  // A memoized Block may live far longer than the input snapshot that produced
  // it. Do not give it a small slice backed by an older complete reply.
  // Native JSON string serialization materializes an independent bounded
  // string, including lone UTF-16 surrogates. Parsing may slice that new
  // block-sized allocation, but cannot pin the complete earlier reply.
  return value === source ? source : JSON.parse(JSON.stringify(value));
}
function append(state, from, to, gap = 1) {
  const last = state.pieces.at(-1);
  if (last && gap === 1 && last.to + 1 === from) last.to = to;
  else state.pieces.push({ from, to, gap: last ? gap : 0 });
}
function materialize(text, pieces, extra, gap = 1) {
  if (!pieces.length) return extra ? text.slice(extra.from, extra.to) : '';
  if (pieces.length === 1 && (!extra || gap === 1 && pieces[0].to + 1 === extra.from)) return text.slice(pieces[0].from, extra ? extra.to : pieces[0].to);
  const chunks = [];
  for (const piece of pieces) { if (piece.gap) chunks.push('\n'.repeat(piece.gap)); chunks.push(text.slice(piece.from, piece.to)); }
  if (extra) chunks.push('\n'.repeat(gap), text.slice(extra.from, extra.to));
  return chunks.join('');
}
function whole(state) { state.whole = true; state.blocks = []; state.pieces = []; state.fence = null; state.blanks = 0; }
function completeLines(text, state, canonical) {
  let end;
  while ((end = text.indexOf('\n', state.scan)) >= 0) {
    const from = state.start, line = text.slice(from, end);
    state.start = state.scan = end + 1;
    if (COMPLETE_DEFINITION.test(line)) { whole(state); return; }
    if (state.fence) {
      append(state, from, end);
      const match = FENCE.exec(line);
      if (match && match[1][0] === state.fence.char && match[1].length >= state.fence.length && !match[2].trim()) state.fence = null;
      continue;
    }
    if (!line.trim()) { if (state.pieces.length) state.blanks++; continue; }
    let gap = 1;
    if (state.blanks) {
      if (/^[ \t]/.test(line) || state.list && LIST_ITEM.test(line)) gap += state.blanks;
      else {
        const value = materialize(text, state.pieces), known = at(canonical, state.blocks.length);
        state.blocks.push(known === value ? known : own(value, text));
        state.pieces = []; state.list = false;
      }
      state.blanks = 0;
    }
    if (!state.pieces.length) state.list = LIST_ITEM.test(line);
    append(state, from, end, gap);
    const match = FENCE.exec(line);
    if (match && !(match[1][0] === '`' && match[2].includes('`'))) state.fence = { char: match[1][0], length: match[1].length };
  }
  state.scan = text.length;
}
function preview(text, state) {
  const line = text.slice(state.start);
  if (DEFINITION.test(line)) whole(state);
  if (state.whole) return { complete: [], count: 0, tail: [text] };
  const tail = [], extra = { from: state.start, to: text.length };
  if (state.fence) tail.push(own(materialize(text, state.pieces, extra), text));
  else if (!line.trim()) { if (state.pieces.length) tail.push(own(materialize(text, state.pieces), text)); }
  else if (state.blanks && !(/^[ \t]/.test(line) || state.list && LIST_ITEM.test(line))) {
    tail.push(own(materialize(text, state.pieces), text), own(line, text));
  } else tail.push(own(materialize(text, state.pieces, extra, state.blanks + 1), text));
  if (!state.blocks.length && !tail.length) tail.push(text);
  return { complete: state.blocks, count: state.blocks.length, tail };
}

/** Derived, per-Markdown cache. It owns no DOM, timers, subscriptions or UI state.
 * Returned arrays are immutable snapshots; edits/rewinds always invalidate the
 * append checkpoint. A speculative React render can safely be followed by any
 * other input: the cache changes work, never the answer. */
export function createMarkdownStream() {
  let previous = null, minimum, state = null, view = null, flat = null, grouped = [], dirtyFrom = 0;
  const reset = () => { previous = null; minimum = undefined; state = null; view = null; flat = null; grouped = []; dirtyFrom = 0; };
  function prepare(text, min) {
    if (previous === text && minimum === min) return;
    if (minimum !== min || previous !== null && previous.length < min) dirtyFrom = 0;
    const canonical = view;
    // Reference definitions require whole-document parsing. Recheck that rule
    // directly rather than validating an otherwise unused full append prefix.
    if (state?.whole && text.length >= min && DEFINITION.test(text)) {
      view = { complete: [], count: 0, tail: [text] }; dirtyFrom = 0;
      previous = text; minimum = min; flat = null; return;
    }
    if (previous === null || text.length < min || !text.startsWith(previous)) {
      state = null; dirtyFrom = 0;
      const initial = previous === null, blocks = splitBlocks(text, min);
      // Borrow the first snapshot: the current Markdown prop already owns its
      // full source. Subsequent changes own only new strings; equal blocks
      // reuse canonical values instead of copying every unchanged paragraph.
      view = { complete: [], count: 0, tail: blocks.map((block, index) => {
        const known = canonical && at(canonical, index);
        return known === block ? known : initial ? block : own(block, text);
      }) };
      if (blocks.length === 1 && blocks[0] === text && text.length >= min && DEFINITION.test(text)) { state = fresh(); whole(state); }
    } else {
      if (!state) {
        state = fresh(); completeLines(previous, state, canonical);
        if (DEFINITION.test(previous.slice(state.start))) whole(state);
      }
      dirtyFrom = Math.min(dirtyFrom, state.blocks.length);
      if (!state.whole) completeLines(text, state, canonical);
      view = preview(text, state);
      if (state.whole) dirtyFrom = 0;
    }
    previous = text; minimum = min; flat = null;
  }
  return {
    split(text, min = 1500) {
      prepare(text, min);
      return flat ||= [...view.complete.slice(0, view.count), ...view.tail];
    },
    groups(text, min = 1500) {
      prepare(text, min);
      if (dirtyFrom === Infinity) return grouped;
      const length = view.count + view.tail.length;
      const reusable = Math.min(Math.floor(dirtyFrom / MARKDOWN_GROUP_SIZE), grouped.length, Math.floor(length / MARKDOWN_GROUP_SIZE));
      const next = grouped.slice(0, reusable);
      for (let start = reusable * MARKDOWN_GROUP_SIZE; start < length; start += MARKDOWN_GROUP_SIZE) {
        const block = []; for (let n = start; n < Math.min(length, start + MARKDOWN_GROUP_SIZE); n++) block.push(at(view, n));
        const prior = grouped[next.length];
        next.push(prior?.length === block.length && block.every((value, index) => value === prior[index]) ? prior : block);
      }
      grouped = next; dirtyFrom = Infinity; return grouped;
    },
    reset,
  };
}
