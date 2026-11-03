'use strict';
// Agent teams: coordinated multi-agent workflows. Every step is an ordinary turn in the same
// thread, so each agent sees the others' work through the normal handoff.

const { runManager } = require('./manager');

const REVIEW_PROMPT = `Review the changes made for this task (look at \`git diff\` and new files). Check correctness, edge cases, tests and anything the task asked for that is missing. Do not change files.
List concrete problems, most important first. If everything is fine, say so briefly.
End your reply with exactly one line: "VERDICT: APPROVED" or "VERDICT: CHANGES REQUESTED".`;
const FIX_PROMPT = 'Address every problem the reviewer raised above. Then summarize what you changed in a few lines.';
const SYNTH_PROMPT = 'Several agents answered the same question above. Compare their answers: where they agree, where they disagree and who is right. Then give one combined recommendation.';

const RECIPES = {
  'plan-build-review': {
    name: 'Plan, build, review',
    description: 'One agent plans, another builds it, a third reviews. The builder fixes until the reviewer approves.',
    roles: [{ id: 'planner', label: 'Planner' }, { id: 'builder', label: 'Builder' }, { id: 'reviewer', label: 'Reviewer' }],
  },
  'build-review': {
    name: 'Build and review',
    description: 'One agent builds, another reviews. The builder fixes until the reviewer approves.',
    roles: [{ id: 'builder', label: 'Builder' }, { id: 'reviewer', label: 'Reviewer' }],
  },
  council: {
    name: 'Ask everyone',
    description: 'Every chosen agent answers the same question without changing files, then one agent compares the answers.',
    roles: [{ id: 'members', label: 'Agents', multi: true }, { id: 'synthesizer', label: 'Summarizer' }],
  },
  manager: {
    name: 'Manager',
    description: 'One agent splits the task into independent pieces. Workers build them at the same time, each in its own copy, and a piece is merged only when it applies cleanly and your tests pass.',
    roles: [{ id: 'planner', label: 'Manager' }, { id: 'workers', label: 'Workers', multi: true }],
  },
};

const verdict = (text) => {
  const m = /^VERDICT: (APPROVED|CHANGES REQUESTED)$/i.exec(String(text || '').trim().split('\n').pop()?.trim() || '');
  return m ? (m[1].toUpperCase() === 'APPROVED' ? 'approved' : 'changes') : 'unknown';
};

function validateTeam(hub, team) {
  const recipe = RECIPES[team?.recipe]; if (!recipe) throw new Error('Unknown team recipe');
  if (!String(team.task || '').trim()) throw new Error('Describe the task for the team');
  if (typeof team.task !== 'string' || team.task.length > 12000) throw new Error('Keep the team task below 12,000 characters.');
  if (team.maxRounds !== undefined && (!Number.isInteger(team.maxRounds) || team.maxRounds < 0 || team.maxRounds > 5)) throw new Error('Choose between zero and five repair rounds.');
  for (const role of recipe.roles) {
    const value = team.roles?.[role.id];
    const ids = role.multi ? value : [value];
    const minimum = role.id === 'workers' ? 1 : 2;
    if (!Array.isArray(ids) || (role.multi && new Set(ids).size < minimum)) throw new Error(role.id === 'workers' ? 'Pick at least one worker agent.' : 'Pick at least two different agents to ask');
    if (ids.length > 8 || new Set(ids).size !== ids.length) throw new Error('Pick up to eight different agents.');
    for (const id of ids) {
      if (!id) throw new Error(`Pick an agent for ${role.id}`);
      const agent = hub.agent(id);
      if (!agent || !agent.available || agent.headless === false) throw new Error(`The selected ${role.id} agent is unavailable.`);
      if ((role.id === 'builder' || role.id === 'workers') && agent.protocol === 'direct-chat') throw new Error('Choose an installed coding agent for building. Direct text connections cannot change files.');
    }
  }
  return team;
}

/**
 * Runs a recipe through hub.send(). team: { recipe, task, roles: { planner, builder, reviewer, members[], synthesizer },
 * mode (for build steps), maxRounds }. onStep(info) reports progress. Returns a summary.
 */
async function runTeam(hub, threadId, team, { onStep, signal } = {}) {
  validateTeam(hub, team);
  const r = RECIPES[team.recipe]; if (!r) throw new Error('Unknown team recipe');
  const roles = team.roles || {}; const buildMode = team.mode === 'full' ? 'full' : 'edit';
  const maxRounds = Math.max(0, Math.min(5, team.maxRounds ?? 2));
  const need = (id) => { const a = roles[id]; if (!a) throw new Error(`Pick an agent for ${id}`); return a; };
  const stopped = () => signal && signal.aborted;
  const step = async (role, opts) => {
    if (stopped()) throw new Error('Team stopped');
    onStep && onStep({ role, agentId: opts.agentId, state: 'running' });
    let m;
    try { m = await hub.send({ threadId, ...opts, team: { recipe: team.recipe, role } }); }
    catch (e) { onStep && onStep({ role, agentId: opts.agentId, state: 'failed', error: e.message }); throw e; }
    onStep && onStep({ role, agentId: opts.agentId, state: m.ok ? 'done' : 'failed', messageId: m.id });
    if (!m.ok) throw new Error(`${hub.agent(opts.agentId).name} (${role}) did not finish`);
    return m;
  };
  const reviewLoop = async () => {
    for (let round = 0; ; round++) {
      const rev = await step('reviewer', { agentId: need('reviewer'), text: REVIEW_PROMPT, mode: 'read' });
      const v = verdict(rev.text);
      if (v === 'approved') return { verdict: 'approved', rounds: round };
      if (v === 'unknown') return { verdict: 'unknown', rounds: round };
      if (round >= maxRounds) return { verdict: v === 'changes' ? 'changes' : 'unknown', rounds: round };
      await step('builder', { agentId: need('builder'), text: FIX_PROMPT, mode: buildMode });
    }
  };
  if (team.recipe === 'plan-build-review') {
    const plan = await step('planner', { agentId: need('planner'), text: team.task, plan: true });
    await step('builder', { agentId: need('builder'), text: '', mode: buildMode, planFrom: plan.id });
    return reviewLoop();
  }
  if (team.recipe === 'build-review') {
    await step('builder', { agentId: need('builder'), text: team.task, mode: buildMode });
    return reviewLoop();
  }
  if (team.recipe === 'manager') return runManager(hub, threadId, team, { step, signal });
  // council
  const members = (roles.members || []).filter(Boolean);
  if (members.length < 2) throw new Error('Pick at least two agents to ask');
  for (const id of members) await step('member', { agentId: id, text: team.task, mode: 'read' });
  await step('synthesizer', { agentId: need('synthesizer'), text: SYNTH_PROMPT, mode: 'read' });
  return { verdict: 'answered', rounds: 0 };
}

module.exports = { RECIPES, runTeam, validateTeam, verdict, REVIEW_PROMPT, FIX_PROMPT, SYNTH_PROMPT };
