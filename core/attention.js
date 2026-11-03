'use strict';
// Fewer things to watch. Running more agents moves the bottleneck to you, so Tributary points at what needs you:
// one list of conversations waiting for an approval, failed (the turn or the checks after it), or finished with
// changes you have not looked at, across every project, most urgent first. System notifications come only when
// an agent is blocked, since a "done" ping in the middle of a review costs more than it tells; finished turns
// still go to the bell. And the computer stays awake while agents run.

const RANK = { permission: 0, failed: 1, review: 2 };

/** [{ threadId, project, title, status, updatedAt }], most urgent first. */
function attention(hub) {
  const out = [];
  for (const p of hub.store.data.projects) {
    for (const t of hub.threads(p.path)) if (t.status in RANK) out.push({ threadId: t.id, project: p.path, title: t.title, status: t.status, updatedAt: t.updatedAt || 0 });
  }
  return out.sort((a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt - a.updatedAt);
}

const BLOCKED = new Set(['permission', 'failed', 'attention']);
/** Whether a notification should also be a system notification. settings.notifyDone adds finished turns. */
const shouldNotify = (n, settings = {}) => BLOCKED.has(n.kind) || (n.kind === 'done' && settings.notifyDone === true);

/** Hold Electron's powerSaveBlocker while any turn or team runs, unless settings.keepAwake is false. */
function keepAwake(blocker, hub) {
  let id = null;
  const update = () => {
    const on = hub.store.data.settings.keepAwake !== false && (hub.running.size > 0 || (hub.teams?.size || 0) > 0);
    if (on && id == null) id = blocker.start('prevent-app-suspension');
    else if (!on && id != null) { blocker.stop(id); id = null; }
  };
  hub.on('running', update); hub.on('state', update);
  return update;
}

module.exports = { attention, shouldNotify, keepAwake };
