'use strict';
// What the sidebar shows for a thread, derived from its last turn: working, permission (a running
// turn waiting for you to allow or deny a tool), review (finished with file changes you have not
// opened since), failed (the turn, or the checks after it), done, or null.

const stopped = (m) => m.error === 'Stopped' || (m.notices || []).includes('Stopped by user');

function changedFiles(m) {
  if (m.kind === 'race' && m.race && !m.race.applied) return (m.race.candidates || []).some((c) => (c.files || []).length);
  return (m.files || []).some((f) => !f.external);
}

function threadStatus(t, { running = false } = {}) {
  const last = [...(t.messages || [])].reverse().find((m) => m.role === 'assistant');
  if (running) return last && (last.permissions || []).some((p) => p.status === 'pending') ? 'permission' : 'working';
  if (!last || last.ok == null) return null;
  if (last.ok === false) return stopped(last) ? null : 'failed';
  if (last.verify?.state === 'failed') return 'failed'; // the checks after it failed
  const finishedAt = (last.ts || 0) + (last.durationMs || 0);
  return changedFiles(last) && (t.seenAt || 0) < finishedAt ? 'review' : 'done';
}

module.exports = { threadStatus };
