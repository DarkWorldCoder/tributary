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
  const m = /VERDICT:\s*(APPROVED|CHANGES REQUESTED)/i.exec(String(text || '').slice(-400));
  return m ? (m[1].toUpperCase() === 'APPROVED' ? 'approved' : 'changes') : 'unknown';
};

/**
 * Runs a recipe through hub.send(). team: { recipe, task, roles: { planner, builder, reviewer, members[], synthesizer },
 * mode (for build steps), maxRounds }. onStep(info) reports progress. Returns a summary.
 */
async function runTeam(hub, threadId, team, { onStep, signal } = {}) {
  const r = RECIPES[team.recipe]; if (!r) throw new Error('Unknown team recipe');
  const roles = team.roles || {}; const buildMode = team.mode === 'full' ? 'full' : 'edit';
  const maxRounds = Math.max(0, Math.min(5, team.maxRounds ?? 2));
  const need = (id) => { const a = roles[id]; if (!a) throw new Error(`Pick an agent for ${id}`); return a; };
  const stopped = () => signal && signal.aborted;
  const step = async (role, opts) => {
    if (stopped()) throw new Error('Team stopped');
    onStep && onStep({ role, agentId: opts.agentId, state: 'running' });
    const m = await hub.send({ threadId, ...opts, team: { recipe: team.recipe, role } });
    onStep && onStep({ role, agentId: opts.agentId, state: m.ok ? 'done' : 'failed', messageId: m.id });
    if (!m.ok) throw new Error(`${hub.agent(opts.agentId).name} (${role}) did not finish`);
    return m;
  };
  const reviewLoop = async () => {
    for (let round = 0; ; round++) {
      const rev = await step('reviewer', { agentId: need('reviewer'), text: REVIEW_PROMPT, mode: 'read' });
      const v = verdict(rev.text);
      if (v === 'approved') return { verdict: 'approved', rounds: round };
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

module.exports = { RECIPES, runTeam, verdict, REVIEW_PROMPT, FIX_PROMPT, SYNTH_PROMPT };
