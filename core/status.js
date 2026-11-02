'use strict';
// What the sidebar shows for a thread, derived from its last turn:
// working, review (finished with file changes you have not opened since), failed, done, or null.

const stopped = (m) => m.error === 'Stopped' || (m.notices || []).includes('Stopped by user');

function changedFiles(m) {
  if (m.kind === 'race' && m.race && !m.race.applied) return (m.race.candidates || []).some((c) => (c.files || []).length);
  return (m.files || []).some((f) => !f.external);
}

function threadStatus(t, { running = false } = {}) {
  if (running) return 'working';
  const last = [...(t.messages || [])].reverse().find((m) => m.role === 'assistant');
  if (!last || last.ok == null) return null;
  if (last.ok === false) return stopped(last) ? null : 'failed';
  const finishedAt = (last.ts || 0) + (last.durationMs || 0);
  return changedFiles(last) && (t.seenAt || 0) < finishedAt ? 'review' : 'done';
}

module.exports = { threadStatus };
