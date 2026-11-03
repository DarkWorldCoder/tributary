'use strict';
// Manager: one agent splits a task into a small graph of independent pieces. Workers build pieces at the same
// time, each in its own git worktree (core/race.js). A piece is merged into your files only when it applies
// cleanly and your tests still pass with it; otherwise it is rolled back and tried once more, with the failure as
// feedback. This is the pattern with the best evidence (docs/MULTI_AGENT_LANDSCAPE.md: task graph, isolated
// workers, test-gated merge). Agents never chat with each other; each gets its part and the list of the others.
const crypto = require('crypto');
const path = require('path');
const { race, applyDiff, runTests } = require('./race');
const { createCheckpoint, restoreCheckpoint } = require('./checkpoint');

const PLAN_PROMPT = `You are the manager of a small team of coding agents. Look at the project, then split the task below into 2 to 6 pieces that different agents can build at the same time, each in its own copy of the project.
- Make the pieces independent. If two pieces would change the same file, make them one piece or make one depend on the other.
- Give each piece clear instructions: what to build, where, and how to check it.
- Do not change any files yourself.
Reply with only a JSON object in this shape:
{"tasks":[{"id":"short-id","title":"Short title","instructions":"What to build and how to check it","files":["paths it will likely change"],"dependsOn":["ids that must be merged first"]}]}`;

// The task list from the manager's reply: a fenced JSON block or the outermost object. Throws when it is unusable.
function parsePlan(text) {
  const src = String(text || '');
  const candidates = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (src.includes('{')) candidates.push(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  let plan = null;
  for (const c of candidates) { try { const v = JSON.parse(c); if (v && Array.isArray(v.tasks)) { plan = v; break; } } catch { /* try the next */ } }
  if (!plan) throw new Error('The manager did not reply with a task list.');
  if (!plan.tasks.length) throw new Error('The manager returned an empty task list.');
  if (plan.tasks.length > 8) throw new Error('Keep the plan to at most 8 pieces.');
  const tasks = plan.tasks.map((t, i) => ({
    id: String(t.id || `t${i + 1}`).replace(/[^\w-]/g, '').slice(0, 40) || `t${i + 1}`,
    title: String(t.title || `Piece ${i + 1}`).slice(0, 120),
    instructions: String(t.instructions || t.title || '').slice(0, 4000),
    files: Array.isArray(t.files) ? t.files.map(String).slice(0, 40) : [],
    dependsOn: Array.isArray(t.dependsOn) ? [...new Set(t.dependsOn.map(String))] : [],
  }));
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) throw new Error('Two pieces in the plan have the same id.');
  for (const t of tasks) for (const d of t.dependsOn) if (!ids.has(d) || d === t.id) throw new Error(`Piece ${t.id} depends on ${d}, which is not another piece in the plan.`);
  const seen = new Map();
  const visit = (id) => {
    if (seen.get(id) === 'open') throw new Error('The plan has a cycle of dependencies.');
    if (seen.get(id) === 'done') return;
    seen.set(id, 'open'); for (const d of tasks.find((t) => t.id === id).dependsOn) visit(d); seen.set(id, 'done');
  };
  for (const t of tasks) visit(t.id);
  return tasks;
}

function workerPrompt(task, tasks, goal, feedback) {
  const others = tasks.filter((t) => t.id !== task.id);
  return [
    'You are one of several coding agents building parts of a larger task at the same time, each in your own copy of the project. Build only your part; the other parts are being built by the others.',
    `## Overall task\n${goal}`,
    `## Your part (id: ${task.id}): ${task.title}\n${task.instructions}${task.files.length ? `\nFiles you will likely change: ${task.files.join(', ')}` : ''}`,
    others.length ? `## Other parts (not yours)\n${others.map((t) => `- ${t.id}: ${t.title}${t.files.length ? ` (${t.files.join(', ')})` : ''}`).join('\n')}` : '',
    feedback ? `## Your previous attempt was not merged\n${feedback}\nStart again from the current files, which include the parts merged so far.` : '',
    'When you are done, make sure the project still builds and its tests pass. Reply with a short summary of what you changed.',
  ].filter(Boolean).join('\n\n');
}

const STATE_TEXT = { waiting: 'waiting', working: 'building', testing: 'testing', merging: 'merging', done: 'merged', failed: 'not merged', skipped: 'skipped' };
const MARK = { done: '[x]', failed: '[!]', skipped: '[-]' };
function summary(items, hub) {
  const merged = items.filter((x) => x.state === 'done').length;
  const lines = items.map((x) => {
    const files = x.files.length ? `, ${x.files.length} file${x.files.length === 1 ? '' : 's'}` : '';
    return `- ${MARK[x.state] || '[ ]'} **${x.title}** (${hub.agent(x.agent)?.name || x.agent}): ${STATE_TEXT[x.state] || x.state}${files}${x.note ? `. ${x.note.split('\n')[0]}` : ''}`;
  });
  return `**Manager: ${merged} of ${items.length} pieces merged**\n\n${lines.join('\n')}`;
}

/**
 * Runs the manager recipe. team: { task, roles: { planner, workers: [agentId] }, testCommand?, mode? }.
 * step(role, opts) runs one ordinary turn (teams.js). Returns { verdict: merged | partial | failed, tasks }.
 */
async function runManager(hub, threadId, team, { step, signal } = {}) {
  const roles = team.roles || {};
  const workers = [...new Set((roles.workers || []).filter(Boolean))].map((id) => hub.agent(id)).filter((a) => a && a.available);
  if (!workers.length) throw new Error('Pick at least one worker agent.');
  const planned = await step('planner', { agentId: roles.planner, text: `${PLAN_PROMPT}\n\n## Task\n${team.task}`, displayText: `Split into pieces: ${team.task}`, mode: 'read' });
  const tasks = parsePlan(planned.text);
  const testCommand = String(team.testCommand || '').trim();
  const mode = team.mode === 'full' ? 'full' : 'edit';

  // The project is reserved for writing while pieces merge; the workers themselves only touch their own copies.
  return hub.withTurn(threadId, true, true, async (git, ac) => {
    if (!git) throw new Error('The manager needs a git repository, so each worker can build in its own copy.');
    const t = hub.thread(threadId); const proj = hub.project(t.project) || {};
    const stop = signal && AbortSignal.any ? AbortSignal.any([ac.signal, signal]) : ac.signal;
    const items = tasks.map((x, i) => ({ ...x, agent: workers[i % workers.length].id, state: 'waiting', activity: '', tests: testCommand ? 'pending' : 'skipped', files: [], diff: '', branch: '', note: '', attempts: 0 }));
    const msg = { id: crypto.randomUUID(), role: 'assistant', agent: roles.planner, kind: 'manager', text: '', thinking: '', tools: [], files: [], plan: null, notices: [], error: null, ok: null,
      ts: Date.now(), mode, team: { recipe: 'manager', role: 'manager' }, manager: { task: team.task, phase: 'building', testCommand, tasks: items } };
    t.messages.push(msg); t.updatedAt = Date.now();
    const update = () => { msg.text = summary(items, hub); hub.emit('event', { threadId, messageId: msg.id, event: { kind: 'manager' }, message: msg }); hub.store.save(false, threadId); };
    update(); hub.emit('message', { threadId, message: msg }); hub.emit('threads', t.project);

    const done = new Set(); const failed = new Set(); const mergedFiles = new Set(); const running = new Map();
    let mergeQueue = Promise.resolve();
    const serial = (fn) => { const p = mergeQueue.then(fn); mergeQueue = p.catch(() => {}); return p; };
    const fail = (task, note) => { task.state = 'failed'; task.note = note; task.activity = ''; failed.add(task.id); update(); };

    // Merge one finished piece into the project files; returns null when merged, or why it was not.
    const merge = (task, c) => serial(async () => {
      if (stop.aborted) return 'Stopped';
      task.state = 'merging'; update();
      const before = await createCheckpoint(git.root, `manager-${msg.id}-${task.id}-${task.attempts}`);
      try { await applyDiff(git.root, c.diff); } catch (e) { return `It conflicted with the pieces merged before it. ${e.message}`; }
      if (testCommand) {
        const tr = await runTests(t.project, testCommand);
        if (!tr.passed) { await restoreCheckpoint(git.root, before); return `The tests failed after merging it with the other pieces, so it was rolled back.\n${tr.output.slice(-2000)}`; }
      }
      return null;
    });

    const build = async (task) => {
      let feedback = '';
      for (task.attempts = 1; task.attempts <= 2; task.attempts++) {
        if (stop.aborted) return fail(task, 'Stopped');
        Object.assign(task, { state: 'working', activity: '', note: task.attempts > 1 ? 'Second attempt' : '' }); update();
        const agent = hub.agent(task.agent);
        const r = await race(hub, { root: git.root, project: t.project, prompts: { [agent.id]: workerPrompt(task, items, team.task, feedback) }, agents: [agent], mode, testCommand,
          extraDirs: proj.folders || [], trusted: proj.trusted !== false, signal: stop,
          onUpdate: (c) => { task.state = c.status === 'running' ? 'working' : c.tests === 'running' ? 'testing' : task.state; task.activity = c.activity || ''; task.tests = c.tests; update(); } });
        const c = r.candidates[0];
        Object.assign(task, { branch: c.branch || '', files: c.files || [], tests: c.tests, diff: c.diff || '', activity: '' });
        if (!c.ok) { feedback = `The agent stopped with an error: ${String(c.error || 'no details').split('\n')[0]}`; continue; }
        if (testCommand && c.tests !== 'passed') { feedback = `The tests failed in your copy.\n${String(c.testOutput || '').slice(-2000)}`; continue; }
        if (!task.files.length) { Object.assign(task, { state: 'done', note: 'No changes were needed' }); done.add(task.id); update(); return; }
        const why = await merge(task, c);
        if (!why) {
          Object.assign(task, { state: 'done', note: testCommand ? 'Merged with the tests passing' : 'Merged' });
          done.add(task.id); for (const f of task.files) mergedFiles.add(f); update(); return;
        }
        feedback = why;
      }
      fail(task, `Not merged after two attempts. ${feedback.split('\n')[0]}`);
    };

    // Start every piece whose dependencies are merged, as many at a time as there are workers.
    for (;;) {
      for (const task of items) {
        const blockers = task.dependsOn.filter((d) => failed.has(d));
        if (task.state === 'waiting' && blockers.length) { Object.assign(task, { state: 'skipped', note: `Skipped because ${blockers.join(', ')} was not merged` }); failed.add(task.id); update(); }
      }
      for (const task of items) {
        if (running.size >= workers.length) break;
        if (task.state !== 'waiting' || running.has(task.id) || !task.dependsOn.every((d) => done.has(d))) continue;
        running.set(task.id, build(task).catch((e) => fail(task, e.message)).finally(() => running.delete(task.id)));
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }

    const merged = items.filter((x) => x.state === 'done').length;
    msg.manager.phase = 'done';
    msg.files = [...mergedFiles].map((rel) => ({ path: path.join(t.project, rel), rel, change: 'M' }));
    msg.ok = merged > 0; msg.durationMs = Date.now() - msg.ts;
    if (stop.aborted) msg.notices.push('Stopped by user');
    update(); hub.store.save(true); hub.emit('message', { threadId, message: msg }); hub.emit('threads', t.project);
    return { verdict: failed.size ? (merged ? 'partial' : 'failed') : 'merged', tasks: items.map(({ diff, ...x }) => x) };
  });
}

// Selection is where parallel candidates win or lose (CodeMonkeys): one agent reads every finished candidate's diff
// and test result and recommends one. It is an ordinary read-only turn, so its reasoning stays in the thread.
const JUDGE_PROMPT = 'Several agents attempted the same task, each in its own copy of the project. Compare their results and pick the one to apply. Judge first whether it does the task correctly without breaking anything, then the test results, then how small and clear the change is. Do not change any files.';
async function judgeRace(hub, threadId, messageId, agentId) {
  const t = hub.thread(threadId); if (!t) throw new Error('Thread not found');
  const m = t.messages.find((x) => x.id === messageId && x.role === 'assistant' && x.race); if (!m) throw new Error('Race not found');
  const done = m.race.candidates.filter((c) => c.status === 'done');
  if (!done.length) throw new Error('No candidate has finished yet');
  const room = Math.max(2000, Math.floor(60000 / done.length));
  const body = done.map((c) => {
    const diff = c.diff || '';
    return `## Candidate: ${hub.agent(c.agent)?.name || c.agent} (id: ${c.agent})\nTests: ${c.tests === 'passed' ? 'passed' : c.tests === 'failed' ? 'failed' : 'not run'}${c.error ? `\nError: ${c.error.split('\n')[0]}` : ''}`
      + `\nChanged files: ${(c.files || []).join(', ') || 'none'}\n\`\`\`diff\n${diff.slice(0, room)}${diff.length > room ? '\n[diff cut short]' : ''}\n\`\`\``;
  }).join('\n\n');
  const text = `${JUDGE_PROMPT}\n\n## Task\n${m.race.task}\n\n${body}\n\nEnd your reply with exactly one line: "WINNER: <id>" with the id of the candidate to apply, or "WINNER: none" if none should be applied.`;
  const reply = await hub.send({ threadId, agentId, text, displayText: 'Pick the best result of the race', mode: 'read', team: { recipe: 'race', role: 'judge' } });
  const pick = /^WINNER:\s*([\w:.@-]+)\s*$/i.exec(String(reply.text || '').trim().split('\n').pop().trim())?.[1];
  const winner = pick && done.some((c) => c.agent === pick) ? pick : null;
  m.race.judge = { agent: agentId, winner, messageId: reply.id };
  hub.store.save(true); hub.emit('message', { threadId, message: m });
  return { winner, messageId: reply.id };
}

module.exports = { runManager, parsePlan, workerPrompt, judgeRace, PLAN_PROMPT, JUDGE_PROMPT };
