'use strict';
// Review with an agent: a read-only turn reads everything this conversation changed and reports problems by file
// and line. The findings come back as comments you can pass to the agent that made the change.
const { diffBetween } = require('./checkpoint');

const REVIEW_PROMPT = `Review the changes in the diff below, made during this conversation. Check correctness, edge cases, security, tests, and anything left unfinished. Do not change any files.
Report each problem on its own line, most important first, exactly like this:
FINDING: <path>:<line in the changed file> | <high|medium|low> | <what is wrong and what to do>
Paths are relative to the repository root, as in the diff. If everything is fine, say so briefly.
End your reply with exactly one line: "VERDICT: APPROVED" or "VERDICT: CHANGES REQUESTED".`;
const MAX_DIFF = 120000;

/** FINDING lines from a review: [{ file, line, severity, note }]. Lines without a path:line are left out. */
function parseFindings(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(?:[-*]\s*)?\**FINDING:?\**\s*(.+?):(\d+)\s*\|\s*(?:(high|medium|low)\s*\|\s*)?(.+?)\s*$/i.exec(line);
    if (m) out.push({ file: m[1].trim().replace(/^[ab]\//, ''), line: Number(m[2]), severity: (m[3] || 'medium').toLowerCase(), note: m[4] });
  }
  return out;
}

async function reviewChanges(hub, threadId, agentId) {
  const t = hub.thread(threadId); if (!t) throw new Error('Thread not found');
  // From before the first turn in the folder the conversation works in now, to the files as they are.
  const here = t.worktree ? hub.workdir(t) : null;
  const first = t.messages.find((m) => m.role === 'assistant' && m.checkpoint && (m.workdir || null) === here);
  if (!first) throw new Error('Nothing has changed in this conversation yet.');
  const { root } = await hub.turnFolder(t, first);
  const diff = await diffBetween(root, first.checkpoint, null);
  if (!diff.trim()) throw new Error('Nothing has changed in this conversation yet.');
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[The diff is longer; the rest was left out.]` : diff;
  const reply = await hub.send({ threadId, agentId, text: `${REVIEW_PROMPT}\n\n\`\`\`diff\n${cut}\n\`\`\``, displayText: 'Review the changes in this conversation', mode: 'read', team: { recipe: 'review', role: 'reviewer' } });
  const findings = parseFindings(reply.text);
  const verdict = (/VERDICT:\s*(APPROVED|CHANGES REQUESTED)/i.exec(reply.text || '') || [])[1]?.toLowerCase() || null;
  const m = hub.thread(threadId)?.messages.find((x) => x.id === reply.id);
  if (m) { m.review = { findings, verdict }; hub.store.save(true); hub.emit('message', { threadId, message: m }); }
  return { messageId: reply.id, findings, verdict };
}

module.exports = { reviewChanges, parseFindings, REVIEW_PROMPT };
