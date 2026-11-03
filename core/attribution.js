'use strict';
// Agent blame: which agent's turn last changed each line of a file. Tributary takes a git checkpoint before every
// turn; replaying the diffs between them, oldest first, gives every line added in a turn's window to that turn.
// Lines from before any turn have no author. Like the Changes tab, a turn's window runs from its checkpoint to the
// next turn's, so an edit made between two turns is credited to the earlier one.
const fs = require('fs');
const path = require('path');
const { createCheckpoint, diffBetween } = require('./checkpoint');
const { gitInfo } = require('./git');
const { projectPath } = require('./files');

// The hunks of a unified diff for one file. Each line is { op, text }; noEol marks the line git printed
// "\ No newline at end of file" after.
function hunks(diff) {
  const out = []; let h = null; let left = 0; let last = null;
  for (const line of String(diff || '').split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (m) { h = { oldStart: Number(m[1]), oldCount: m[2] == null ? 1 : Number(m[2]), lines: [] }; left = h.oldCount + (m[3] == null ? 1 : Number(m[3])); out.push(h); continue; }
    if (line[0] === '\\') { if (last) last.noEol = true; continue; }
    // Counting the hunk's lines tells a removed "-- x" apart from the next file's "--- a/x" header.
    if (!h || left <= 0 || !(line[0] === ' ' || line[0] === '+' || line[0] === '-')) continue;
    last = { op: line[0], text: line.slice(1) }; h.lines.push(last);
    left -= line[0] === ' ' ? 2 : 1;
  }
  return out;
}

// Apply one diff to a per-line author list (indexes into the turn list, -1 for none). Added lines get `who`, or
// who(change) for a function: the diff's changes numbered in order, a change being a run of added and removed lines.
function replay(authors, diff, who) {
  const out = []; let i = 0; let change = -1;
  for (const h of hunks(diff)) {
    const start = h.oldCount === 0 ? h.oldStart : h.oldStart - 1; // a pure insertion comes after line oldStart
    while (i < start && i < authors.length) out.push(authors[i++]);
    let prev = ' ';
    for (const { op } of h.lines) {
      if (op !== ' ' && prev === ' ') change++;
      prev = op;
      if (op === ' ') out.push(i < authors.length ? authors[i++] : -1);
      else if (op === '-') i++;
      else out.push(typeof who === 'function' ? who(change) : who);
    }
  }
  while (i < authors.length) out.push(authors[i++]);
  return out;
}
// The changes of a diff, numbered as replay numbers them: { removed: [line], added: [line] }.
function changes(diff) {
  const out = [];
  for (const h of hunks(diff)) {
    let prev = ' ';
    for (const l of h.lines) {
      if (l.op !== ' ' && prev === ' ') out.push({ removed: [], added: [] });
      prev = l.op;
      if (l.op !== ' ') out[out.length - 1][l.op === '-' ? 'removed' : 'added'].push(l);
    }
  }
  return out;
}
const delta = (diff) => hunks(diff).reduce((n, h) => n + h.lines.filter((x) => x.op === '+').length - h.lines.filter((x) => x.op === '-').length, 0);
const lineCount = (text) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);

// Every checkpointed turn that changed the file, oldest first, and the diffs that take it from before the first of
// them to now: one segment per turn's window, and one with no author (-1) for each stretch between or after them.
// Undoing a change ends the window it falls in (m.undone), so lines put back are nobody's, not the latest turn's.
async function history(hub, project, rel) {
  const abs = path.resolve(project, rel);
  const g = await gitInfo(project);
  if (!g) return null;
  const relRoot = path.relative(g.root, abs).split(path.sep).join('/');
  // Every checkpointed turn in this repository, oldest first, whichever conversation it was in.
  const all = [];
  for (const t of hub.store.data.threads) {
    if (!(t.project === g.root || t.project.startsWith(`${g.root}${path.sep}`) || t.project === project)) continue;
    t.messages.forEach((m, i) => {
      if (m.role === 'assistant' && m.checkpoint) all.push({ t, m, prompt: t.messages[i - 1], ts: m.ts || 0, checkpoint: m.checkpoint });
      for (const u of m.undone || []) if (u.rel === relRoot) all.push({ ts: u.ts, checkpoint: u.checkpoint });
    });
  }
  all.sort((a, b) => a.ts - b.ts);
  const turns = []; const segments = [];
  let last = null; // where the previous segment ended (a checkpoint, or null for the files now)
  all.forEach(({ t, m, prompt }, i) => {
    if (!m || !(m.files || []).some((f) => f.path === abs)) return;
    const after = all[i + 1]?.checkpoint ?? null;
    if (segments.length && last !== m.checkpoint) segments.push({ from: last, to: m.checkpoint, who: -1 });
    turns.push({ agent: m.agent, threadId: t.id, title: t.title, messageId: m.id, ts: m.ts, request: String(prompt?.role === 'user' ? prompt.text : '').slice(0, 200) });
    segments.push({ from: m.checkpoint, to: after, who: turns.length - 1 });
    last = after;
  });
  if (last) segments.push({ from: last, to: null, who: -1 }); // changes since the last turn that touched it
  let now = ''; let mtime = 0;
  try { now = fs.readFileSync(abs, 'utf8'); mtime = fs.statSync(abs).mtimeMs; } catch { return null; }
  for (const s of segments) s.diff = s.from ? await diffBetween(g.root, s.from, s.to, relRoot).catch(() => '') : '';
  return { root: g.root, relRoot, now, mtime, turns, segments };
}

// The author of every line now: the turn's index, -1 for none, or tag(segment, change) where a function is given.
function blame(h, tag) {
  const total = lineCount(h.now);
  if (!h.segments.length) return Array(total).fill(-1);
  // The file's length before the first segment, worked back from its length now.
  let authors = Array(Math.max(0, total - h.segments.reduce((n, s) => n + delta(s.diff), 0))).fill(-1);
  h.segments.forEach((s, i) => { authors = replay(authors, s.diff, tag ? (c) => tag(i, s, c) : s.who); });
  if (authors.length !== total) authors = authors.slice(0, total).concat(Array(Math.max(0, total - authors.length)).fill(-1));
  return authors;
}

/** { authors: [turn index or -1 per current line], turns: [{ agent, threadId, title, messageId, ts, request }] } */
async function lineAuthors(hub, project, rel) {
  const h = await history(hub, project, rel);
  return h ? { authors: blame(h), turns: h.turns } : { authors: [], turns: [] };
}

/**
 * Undo one change a turn made to a file: the run of lines it added around `line` (1-based, in the file now) goes
 * back to what was there before the turn. The rest of the file, the turn's other changes and other agents' lines
 * stay as they are. Refused if any of those lines was edited since. Returns the new text and where it changed.
 */
async function revertTurnHunk(hub, project, rel, messageId, line) {
  const abs = await projectPath(project, rel);
  const h = await history(hub, project, rel);
  const turn = h ? h.turns.findIndex((t) => t.messageId === messageId) : -1;
  if (turn < 0) throw new Error('That turn did not change this file.');
  const name = hub.agent?.(h.turns[turn].agent)?.name || h.turns[turn].agent;
  const seg = h.segments.findIndex((s) => s.who === turn);
  const tags = blame(h, (i, s, c) => (i === seg ? { change: c } : s.who));
  const at = tags[line - 1];
  if (!at || typeof at !== 'object') throw new Error(`${name}'s turn didn't change this line.`);
  const { removed, added } = changes(h.segments[seg].diff)[at.change];
  // The lines it added must all still be there, together and as the agent wrote them.
  const eol = h.now.endsWith('\n');
  const lines = h.now ? (eol ? h.now.slice(0, -1) : h.now).split('\n') : [];
  const where = tags.flatMap((x, i) => (x && typeof x === 'object' && x.change === at.change ? [i] : []));
  const first = where[0];
  if (where.length !== added.length || where.some((x, k) => x !== first + k || lines[x] !== added[k].text)) {
    throw new Error(`These lines changed since ${name}'s turn, so that change can't be undone on its own.`);
  }
  const atEnd = first + added.length === lines.length;
  lines.splice(first, added.length, ...removed.map((l) => l.text));
  // At the end of the file, the final newline goes back to how it was before the turn too.
  const text = lines.length ? `${lines.join('\n')}${(atEnd ? !removed[removed.length - 1]?.noEol : eol) ? '\n' : ''}` : '';
  const checkpoint = await createCheckpoint(h.root, `undo ${messageId}`);
  if (Math.abs(fs.statSync(abs).mtimeMs - h.mtime) > 1) throw new Error('The file changed while undoing. Try again.');
  fs.writeFileSync(abs, text);
  const t = hub.thread(h.turns[turn].threadId); const m = t?.messages.find((x) => x.id === messageId);
  if (m) { m.undone = [...(m.undone || []), { rel: h.relRoot, checkpoint, ts: Date.now() }]; hub.store.save(false, t.id); }
  return { text, mtime: fs.statSync(abs).mtimeMs, agent: h.turns[turn].agent, from: first + 1, removed: added.length, restored: removed.length };
}

module.exports = { lineAuthors, revertTurnHunk, replay, hunks };
