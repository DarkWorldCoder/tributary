'use strict';
// Build the prompt for an agent so it can continue a thread other agents started.
// - Same agent, nobody else spoke since its last turn: send the message as-is (it resumes its own session).
// - Same agent, others spoke since: resume its session and include only what happened since.
// - Agent new to this thread: start a fresh session with a compact digest of the whole thread.

const BUDGET = 12000;   // characters of transcript to include
const PER_MSG = 1800;   // max characters per message in the digest

function summarizeTools(tools = []) {
  const cmds = tools.filter((t) => t.name === 'shell' || /^bash$/i.test(t.name)).map((t) => (t.input && (t.input.command || t.input.cmd)) || '').filter(Boolean);
  const files = [...new Set((tools || []).flatMap((t) => t.files || []))];
  const parts = [];
  if (files.length) parts.push(`edited: ${files.slice(0, 12).join(', ')}${files.length > 12 ? ` (+${files.length - 12})` : ''}`);
  if (cmds.length) parts.push(`ran: ${cmds.slice(0, 6).map((c) => (Array.isArray(c) ? c.join(' ') : String(c)).slice(0, 80)).join('; ')}`);
  const others = tools.filter((t) => t.name !== 'shell' && !/^bash$/i.test(t.name)).length;
  if (others) parts.push(`${others} other tool calls`);
  return parts.join(' | ');
}

function fmt(m, names) {
  const who = m.role === 'user' ? 'User' : (names[m.agent] || m.agent || 'Agent');
  let body = (m.text || '').trim();
  if (body.length > PER_MSG) body = `${body.slice(0, PER_MSG)} …[truncated]`;
  const tools = m.role === 'assistant' ? summarizeTools(m.tools) : '';
  return `### ${who}\n${body || '(no text)'}${tools ? `\n[${tools}]` : ''}`;
}

function digest(messages, names, budget = BUDGET) {
  budget = Math.max(0, Math.min(BUDGET, Number.isFinite(budget) ? Math.floor(budget) : BUDGET));
  if (!budget || !messages.length) return '';
  const original = fmt(messages[0], names);
  if (messages.length === 1) return original.slice(0, budget);
  // Only format the bounded tail. Long sessions should not rebuild their entire transcript.
  const tail = []; let size = original.length;
  for (let i = messages.length - 1; i >= 1; i--) {
    const part = fmt(messages[i], names); tail.unshift(part); size += part.length + 2;
    if (size > budget) break;
    if (i === 1) return [original, ...tail].join('\n\n');
  }
  const first = original.slice(0, Math.floor(budget / 3));
  const marker = '\n\n(… earlier messages omitted to fit the handoff budget …)\n\n';
  const kept = []; let remaining = Math.max(0, budget - first.length - marker.length);
  for (let i = tail.length - 1; i >= 0 && remaining > 0; i--) {
    const part = tail[i].slice(0, Math.max(0, remaining - (kept.length ? 2 : 0)));
    if (!part) break;
    remaining -= part.length + (kept.length ? 2 : 0); kept.unshift(part);
    if (part.length < tail[i].length) break;
  }
  return `${first}${marker}${kept.join('\n\n')}`.slice(0, budget);
}

function gitBlock(git) {
  if (!git) return '';
  const files = git.changed.slice(0, 40).map((c) => `${c.code.padEnd(2)} ${c.path}`).join('\n');
  return `\n\n## Working tree (branch ${git.branch || '?'})\n${files || '(clean)'}${git.changed.length > 40 ? `\n… ${git.changed.length - 40} more` : ''}`;
}

/**
 * plan({ thread, agentId, text, names, git }) -> { prompt, resumeId, handoff: bool, kind }
 * thread.messages excludes the new user message.
 */
function plan({ thread, agentId, text, names = {}, git }) {
  const msgs = thread.messages || [];
  const sessionId = (thread.agentSessions || {})[agentId] || null;
  let last = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant' && msgs[i].agent === agentId) { last = i; break; }
  const header = thread.task ? '[Tributary handoff] Continue this everyday task using the supplied context. Do not run commands, modify files, browse, or send messages.' : '[Tributary handoff] You are joining a coding session in this same project folder. Other agents may have already changed files.';

  if (sessionId && last >= 0) {
    const since = msgs.slice(last + 1);
    const othersSpoke = since.some((m) => m.role === 'assistant' && m.agent !== agentId);
    if (!othersSpoke) return { prompt: text, resumeId: sessionId, handoff: false, kind: 'resume' };
    const prompt = `${header}\nSince your last reply, this happened:\n\n${digest(since, names)}${gitBlock(git)}\n\n## Current request\n${text}`;
    return { prompt, resumeId: sessionId, handoff: true, kind: 'catch-up' };
  }
  if (!msgs.length) return { prompt: text, resumeId: null, handoff: false, kind: 'new' };
  const prompt = `${header}\nHere is the conversation so far:\n\n${digest(msgs, names)}${gitBlock(git)}\n\n## Current request\n${text}`;
  return { prompt, resumeId: null, handoff: true, kind: 'join' };
}

module.exports = { plan, digest, summarizeTools };
