'use strict';
// Claude Code's stream-json host permission channel. No SDK or global config changes.
const EDIT = /^(Edit|Write|MultiEdit|NotebookEdit)$/i;
const OPTIONS = [
  { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
];
function createClaudeControl({ write, mode, emit, sessionId }) {
  const pending = new Map(); let closed = false;
  const reply = (id, response) => { if (!closed) write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }); };
  return {
    async request(event) {
      if (closed || typeof event.requestId !== 'string' || pending.has(event.requestId)) return;
      const raw = event.control || {}; const name = raw.tool_name || 'Tool';
      if (raw.subtype !== 'can_use_tool') {
        write({ type: 'control_response', response: { subtype: 'error', request_id: event.requestId, error: 'Unsupported host request' } }); return;
      }
      // Starting implementation remains an explicit new turn with its selected permission mode.
      if (name === 'ExitPlanMode' || mode === 'read' && EDIT.test(name)) {
        const reason = name === 'ExitPlanMode' ? 'Return the plan for review. The user starts implementation separately.' : 'File changes are disabled in Read-only mode.';
        emit({ kind: 'notice', text: reason }); reply(event.requestId, { behavior: 'deny', message: reason }); return;
      }
      const input = raw.input && typeof raw.input === 'object' ? raw.input : {};
      let questions;
      if (name === 'AskUserQuestion') {
        const valid = Array.isArray(input.questions) && input.questions.length > 0 && input.questions.length <= 4 && input.questions.every((q) => typeof q.question === 'string' && q.question.length > 0 && q.question.length <= 1000 && Array.isArray(q.options) && q.options.length <= 8 && q.options.every((o) => typeof o.label === 'string' && o.label.length > 0 && o.label.length <= 200));
        if (!valid || new Set(input.questions.map((q) => q.question)).size !== input.questions.length) { reply(event.requestId, { behavior: 'deny', message: 'Ask these questions in your response instead.' }); return; }
        questions = input.questions.map((q) => ({ question: q.question, multiSelect: q.multiSelect === true, options: q.options.map((o) => ({ label: o.label, description: typeof o.description === 'string' ? o.description.slice(0, 1000) : '' })) }));
      }
      const kind = EDIT.test(name) ? 'edit' : name === 'Bash' ? 'execute' : name === 'WebFetch' ? 'fetch' : name === 'Read' ? 'read' : 'other';
      const ask = { kind: 'permission', request: { sessionId: sessionId(), toolCallId: raw.tool_use_id || event.requestId,
        title: String(raw.description || raw.display_name || name).slice(0, 500), kind,
        command: typeof input.command === 'string' ? input.command : undefined,
        path: typeof input.file_path === 'string' ? input.file_path : typeof raw.blocked_path === 'string' ? raw.blocked_path : undefined,
        options: questions ? OPTIONS.filter((option) => option.optionId === 'reject') : OPTIONS.map((option) => ({ ...option })), ...(questions ? { questions } : {}) } };
      pending.set(event.requestId, ask);
      try {
        emit(ask);
        const choice = ask.answer ? await ask.answer : 'reject';
        if (!pending.delete(event.requestId) || closed) return;
        const allow = questions ? choice && typeof choice === 'object' && choice.answers : choice === 'once' || choice === 'always';
        reply(event.requestId, allow ? { behavior: 'allow', updatedInput: questions ? { ...input, answers: choice.answers } : input } : { behavior: 'deny', message: choice == null ? 'The request was cancelled.' : 'The user denied this.', ...(choice == null ? { interrupt: true } : {}) });
      } catch {
        pending.delete(event.requestId); reply(event.requestId, { behavior: 'deny', message: 'The host could not approve this request.' });
      }
    },
    withdraw(id) { const ask = pending.get(id); pending.delete(id); ask?.withdraw?.(); },
    close() { closed = true; for (const ask of pending.values()) ask.withdraw?.(); pending.clear(); },
  };
}
module.exports = { createClaudeControl };
