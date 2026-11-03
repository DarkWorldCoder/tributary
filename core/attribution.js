'use strict';
// Agent blame: which agent's turn last changed each line of a file. Tributary takes a git checkpoint before every
// turn; replaying the diffs between them, oldest first, gives every line added in a turn's window to that turn.
// Lines from before any turn have no author. Like the Changes tab, a turn's window runs from its checkpoint to the
// next turn's, so an edit made between two turns is credited to the earlier one.
const fs = require('fs');
const path = require('path');
const { diffBetween } = require('./checkpoint');
const { gitInfo } = require('./git');

// The hunks of a unified diff for one file.
function hunks(diff) {
  const out = []; let h = null;
  for (const line of String(diff || '').split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (m) { h = { oldStart: Number(m[1]), oldCount: m[2] == null ? 1 : Number(m[2]), lines: [] }; out.push(h); continue; }
    if (h && (line[0] === ' ' || line[0] === '+' || line[0] === '-') && !line.startsWith('+++') && !line.startsWith('---')) h.lines.push(line[0]);
  }
  return out;
}

// Apply one diff to a per-line author list (indexes into the turn list, -1 for none). Added lines get `who`.
function replay(authors, diff, who) {
  const out = []; let i = 0;
  for (const h of hunks(diff)) {
    const start = h.oldCount === 0 ? h.oldStart : h.oldStart - 1; // a pure insertion comes after line oldStart
    while (i < start && i < authors.length) out.push(authors[i++]);
    for (const op of h.lines) {
      if (op === ' ') out.push(i < authors.length ? authors[i++] : -1);
      else if (op === '-') i++;
      else out.push(who);
    }
  }
  while (i < authors.length) out.push(authors[i++]);
  return out;
}
const delta = (diff) => hunks(diff).reduce((n, h) => n + h.lines.filter((x) => x === '+').length - h.lines.filter((x) => x === '-').length, 0);
const lineCount = (text) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);

/** { authors: [turn index or -1 per current line], turns: [{ agent, threadId, title, messageId, ts, request }] } */
async function lineAuthors(hub, project, rel) {
  const abs = path.resolve(project, rel);
  const g = await gitInfo(project);
  if (!g) return { authors: [], turns: [] };
  const relRoot = path.relative(g.root, abs).split(path.sep).join('/');
  // Every checkpointed turn in this repository, oldest first, whichever conversation it was in. A turn counts where
  // it ran: a conversation's separate copy (m.workdir) is a working tree of its own, with its own checkpoints.
  const all = [];
  for (const t of hub.store.data.threads) {
    t.messages.forEach((m, i) => {
      const where = m.workdir || t.project;
      if (m.role === 'assistant' && m.checkpoint && (where === g.root || where.startsWith(`${g.root}${path.sep}`) || where === project)) all.push({ t, m, prompt: t.messages[i - 1] });
    });
  }
  all.sort((a, b) => (a.m.ts || 0) - (b.m.ts || 0));
  const turns = []; const segments = [];
  let last = null; // where the previous segment ended (a checkpoint, or null for the files now)
  all.forEach(({ t, m, prompt }, i) => {
    if (!(m.files || []).some((f) => f.path === abs)) return;
    const after = all[i + 1]?.m.checkpoint ?? null;
    if (segments.length && last !== m.checkpoint) segments.push({ from: last, to: m.checkpoint, who: -1 });
    turns.push({ agent: m.agent, threadId: t.id, title: t.title, messageId: m.id, ts: m.ts, request: String(prompt?.role === 'user' ? prompt.text : '').slice(0, 200) });
    segments.push({ from: m.checkpoint, to: after, who: turns.length - 1 });
    last = after;
  });
  if (last) segments.push({ from: last, to: null, who: -1 }); // changes since the last turn that touched it
  let now = '';
  try { now = fs.readFileSync(abs, 'utf8'); } catch { return { authors: [], turns: [] }; }
  const total = lineCount(now);
  if (!segments.length) return { authors: Array(total).fill(-1), turns: [] };
  const diffs = [];
  for (const s of segments) diffs.push(s.from ? await diffBetween(g.root, s.from, s.to, relRoot).catch(() => '') : '');
  // The file's length before the first segment, worked back from its length now.
  let authors = Array(Math.max(0, total - diffs.reduce((n, d) => n + delta(d), 0))).fill(-1);
  segments.forEach((s, i) => { authors = replay(authors, diffs[i], s.who); });
  if (authors.length !== total) authors = authors.slice(0, total).concat(Array(Math.max(0, total - authors.length)).fill(-1));
  return { authors, turns };
}

module.exports = { lineAuthors, replay, hunks };
