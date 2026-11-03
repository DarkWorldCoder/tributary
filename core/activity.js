'use strict';
// What every agent is doing right now, across conversations, teams, races and managed runs: the live view.
// One entry per busy thread, with a worker per agent: its state, the tool it is running, and the files it changed.
const { RECIPES } = require('./teams');

const label = (tool) => {
  if (!tool) return '';
  const input = tool.input || {};
  const target = input.command || input.file_path || input.path || input.pattern || input.url || '';
  return `${tool.name || 'tool'} ${Array.isArray(target) ? target.join(' ') : target}`.trim().slice(0, 200);
};
const files = (list) => (list || []).filter((f) => !f.external).map((f) => (typeof f === 'string' ? { rel: f } : { rel: f.rel, change: f.change }));

// A worker for one agent turn (a plain turn or one team step).
function turnWorker(m, role) {
  const running = m.ok == null;
  const tool = [...(m.tools || [])].reverse().find((x) => x.status === 'running') || (m.tools || []).at(-1);
  return {
    key: m.id, agent: m.agent, role: role || m.team?.role || null, messageId: m.id, startedAt: m.ts,
    state: running ? 'working' : m.ok ? 'done' : 'failed',
    doing: running ? (label(tool) || (m.text ? 'Writing a reply' : 'Thinking')) : '',
    files: files(m.files), tools: (m.tools || []).length,
  };
}

function candidateState(c) {
  if (c.status === 'running') return 'working';
  if (c.tests === 'running') return 'testing';
  return c.ok === false || c.error ? 'failed' : 'done';
}

function activityOf(hub) {
  const out = [];
  for (const threadId of new Set([...hub.running.keys(), ...hub.teams.keys()])) {
    const t = hub.thread(threadId); if (!t) continue;
    const m = [...t.messages].reverse().find((x) => x.role === 'assistant');
    const team = hub.teams.get(threadId);
    const entry = { threadId, title: t.title, project: t.project, startedAt: m?.ts, kind: 'turn', workers: [] };
    if (m?.kind === 'race' && m.race) {
      Object.assign(entry, { kind: 'race', messageId: m.id });
      entry.workers = m.race.candidates.map((c) => ({ key: `${m.id}:${c.agent}`, agent: c.agent, role: 'candidate', messageId: m.id, state: candidateState(c),
        doing: c.status === 'running' ? c.activity || 'Starting' : c.tests === 'running' ? 'Running the tests' : '', tests: c.tests, files: files(c.files), branch: c.branch }));
    } else if (m?.kind === 'manager' && m.manager) {
      Object.assign(entry, { kind: 'manager', messageId: m.id, phase: m.manager.phase });
      entry.workers = (m.manager.tasks || []).map((task) => ({ key: `${m.id}:${task.id}`, agent: task.agent, role: task.title, messageId: m.id, state: task.state,
        doing: task.state === 'working' ? task.activity || 'Starting' : task.state === 'testing' ? 'Running the tests' : task.state === 'merging' ? 'Merging' : task.note || '',
        tests: task.tests, files: files(task.files), branch: task.branch, taskId: task.id }));
    } else if (team) {
      // Every step so far, the running one with its live tool and files.
      Object.assign(entry, { kind: 'team', recipe: team.recipe, recipeName: (RECIPES[team.recipe] || {}).name || 'Team' });
      entry.workers = team.steps.map((s, i) => {
        const sm = s.messageId ? t.messages.find((x) => x.id === s.messageId) : (s.state === 'running' && m && m.ok == null && m.team?.role === s.role ? m : null);
        return sm ? { ...turnWorker(sm, s.role), key: `${threadId}:${i}`, state: s.state === 'running' ? 'working' : s.state }
          : { key: `${threadId}:${i}`, agent: s.agentId, role: s.role, state: s.state === 'running' ? 'working' : s.state, doing: s.state === 'running' ? 'Starting' : '', files: [] };
      });
    } else if (m && m.ok == null) {
      entry.workers = [turnWorker(m)];
    }
    out.push(entry);
  }
  return out.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

// Tell listeners ('activity' event) when the live view changes, at most a few times a second.
function watchActivity(hub, ms = 250) {
  let timer = null; let last = '[]';
  const flush = () => {
    timer = null;
    const now = activityOf(hub); const key = JSON.stringify(now);
    if (key !== last) { last = key; hub.emit('activity', now); }
  };
  const poke = () => { if (!timer) timer = setTimeout(flush, ms); };
  for (const name of ['event', 'running', 'state', 'message']) hub.on(name, poke);
}

module.exports = { activityOf, watchActivity };
