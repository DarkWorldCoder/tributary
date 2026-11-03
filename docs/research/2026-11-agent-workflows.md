# What developers need from a multi-agent coding app (research, 3 November 2026)

Four research passes fed this summary:

1. The documentation and changelogs of 16 apps. Every Conductor changelog entry (208) was read.
2. What developers report: 2,147 Hacker News comments from 2026, 40 Reddit threads, GitHub issues sorted by reactions, and 31 blog posts.
3. How teams share secrets and agent config.
4. How products support team collaboration around agents, and what makes each agent more effective.

The frequency figures come from rough keyword tagging, so read them as tiers rather than measurements. "Vendor claim" marks numbers that come from the vendor itself.

## The main finding: people, not agents, are the bottleneck

More agents running in parallel moves the bottleneck onto human attention, merging and runtime environments. Most practitioners settle on supervising 2–3 agents at once, although vendors advertise 8–20.

A controlled study found that turning on concurrency in Codex, Claude Code and Kimi raised runtime in 14 of 15 setups and used up to 3× the tokens. It also cut success on short tasks by 24 points. The most common failure was sub-agents overwriting each other's work ([arXiv 2610.10263](https://arxiv.org/abs/2610.10263)). Tributary keeps parallel work in separate copies and gates merges on tests for this reason.

## What developers struggle with, ranked by frequency × severity

1. **Reviewing what agents produce.** This is the most common theme in essays: 17 of the 31 posts. When review is skimmed, problems such as moved auth checks and migrations in the wrong order get through. Sources: [Osmani](https://addyo.substack.com/p/the-code-nobody-reads), [Perkins](https://nickperkins.au/article/parallel-agents-review-gate/).
2. **Conflicts between agents.** Separate worktrees stop agents from writing the same files. They do not stop clashing design choices or duplicated infrastructure. Sources: [Tornhill](https://adamtornhill.substack.com/p/why-merge-conflicts-became-the-new), [Foremerge (HN)](https://news.ycombinator.com/item?id=49789356).
3. **Cost and rate limits.** This is the largest GitHub signal: Claude Code #16157 has 727 reactions. Hidden orchestration overhead is common; one team found background-agent status summaries were 16.4% of its spend ([HN](https://news.ycombinator.com/item?id=50284255)).
4. **Worktrees that don't run.** A new worktree has no `.env` and no `node_modules`, every dev server wants port 3000, and agents share one database. Sources: [Chirico](https://augustochirico.dev/blog/git-worktrees-hidden-cost/), [Wolinski](https://wolinski.com/blog/parallel-agents-on-git-worktrees.html).
5. **"Done" isn't done.** Agents report that tests pass while the wider system is broken.
6. **Knowing which agent needs you.** Agents sit waiting on approvals nobody saw. A "task complete" ping that arrives mid-review destroys the reader's focus. Heavy users want interruptions only when an agent is blocked.
7. **Losing context** between sessions and between agents.
8. **Trust and secrets.** Constant permission prompts push people towards YOLO mode, and worktrees are not a security boundary ([HN](https://news.ycombinator.com/item?id=49110389)).
9. **Weak diff and review tools**, and not knowing which branch belongs to which agent.
10. **Machine resources.** Laptops run hot, and each worktree rebuilds from scratch.
11. **Team config drift.** The request for one shared instructions file (AGENTS.md) has 6,689 reactions, the most of any issue found.

## What other apps already do (verified from docs and changelogs)

| Feature | Apps | Source |
|---|---|---|
| Copy `.env` and other gitignored files into worktrees | Conductor, Codex app, VS Code, Vibe Kanban, JetBrains Air | [Conductor files to copy](https://www.conductor.build/docs/reference/files-to-copy) |
| Setup and archive scripts committed to the repo | Conductor, Paradev, Copilot app, Cursor, Air, Amp, Sculptor | [Conductor scripts](https://www.conductor.build/docs/reference/scripts) |
| A block of ports for each workspace | Conductor (10 ports), Amp | [Conductor environment variables](https://www.conductor.build/docs/reference/environment-variables) |
| Comments on diff lines sent to the agent | Conductor, Codex, Antigravity, Air, Warp, Vibe Kanban, Paradev | [Antigravity review changes](https://antigravity.google/docs/review-changes) |
| Agent resolves merge conflicts | Conductor, Air, Copilot | [Air review changes](https://www.jetbrains.com/help/air/air-in-ides-review-changes.html) |
| Checks tab with "fix failing CI" | Conductor, Codex, Copilot app, Paradev | [Conductor checks](https://www.conductor.build/docs/reference/checks) |
| Agent watches a PR, fixes CI, then merges | Copilot Agent Merge, Sculptor | [Sculptor CI babysitter](https://github.com/imbue-ai/sculptor/blob/main/docs/help/ci_babysitter.md) |
| Steer an agent mid-turn | Conductor, Amp, Zed, Cursor, Codex | [Amp: steer, don't queue](https://ampcode.com/news/steer-dont-queue) |
| Click a UI element in a built-in browser to send it to the agent | Paradev, Conductor, Codex, Cursor, Amp | [Paradev browser](https://docs.paradev.com/browser) |
| Agents on a schedule or on events | Conductor, Codex, Copilot, Paradev, Amp | [Codex automations](https://learn.chatgpt.com/docs/automations) |
| Quota meters and spend caps | Paradev, Copilot, OpenHands, Air | [Paradev usage](https://docs.paradev.com/usage) |
| Judge plus "Synthesize" the best attempts | VS Code (judge and synthesize), Cursor (judge only) | [VS Code 1.143](https://code.visualstudio.com/updates/v1_143) |
| Jump to the next thread that needs you | Conductor (⌘⌥L), Codex (⌘⌥A) | Conductor changelog |

Product status as of November 2026:
- The company behind Vibe Kanban shut down in April 2026; the app is now community-maintained.
- Crystal was replaced by Nimbalyst.
- Superset was renamed Paradev.
- Jules shuts down on 31 December 2026.
- GitHub's desktop Copilot app has been generally available since June 2026.

## Sharing environments and secrets across a team

- **`.worktreeinclude` is the shared format.** It lists gitignored files to copy into new worktrees, in gitignore syntax. Claude Code ([docs](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees)), the Codex app and Conductor all read it. Copy the files rather than symlinking them, so that one agent's write does not change every worktree.
- **Run setup scripts only after the user trusts them, tied to the script's hash.** See [gtr trust](https://github.com/coderabbitai/git-worktree-runner/blob/main/docs/configuration.md).
- **Team secrets.** SOPS with one [age](https://getsops.io/docs/) key per member is the open-source option that keeps encrypted values in the repo and supports per-member revocation. Revoking access also means rotating the real values, because git history keeps the old ciphertext. The alternatives fall short:
  - dotenvx gives per-member access only through its paid Armor service.
  - git-crypt cannot revoke access.
- **Keep secrets out of transcripts.**
  - Redact the values you inject. Cursor does this ([docs](https://cursor.com/docs/cloud-agent/security-network.md)).
  - Scan commits, for example with [gitleaks](https://github.com/gitleaks/gitleaks). Commits co-authored by Claude Code leaked secrets at 3.2%, against a 1.5% baseline ([GitGuardian 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/)).
- **Shared agent config.**
  - AGENTS.md is now a Linux Foundation standard.
  - Commit `.mcp.json` with `${VAR}` placeholders, as [Claude Code MCP](https://code.claude.com/docs/en/mcp) supports, instead of literal secrets.

## Making each agent more effective

| Practice | Evidence | Source |
|---|---|---|
| Lint, type check or tests after each edit, with failures fed back | Measured: 18.0% vs 15.0% solved on SWE-bench Lite | [SWE-agent](https://arxiv.org/abs/2405.15793) |
| A reviewer agent checks the diff before a person sees it | Vendor claim: PRs with substantive comments rose from 16% to 54% | [Claude Code review](https://claude.com/blog/code-review) |
| A critic picks the race winner, with early stopping | Vendor-run: Best@8 73.8% vs 57.9% random | [OpenHands](https://openhands.dev/blog/20260305-learning-to-verify-ai-generated-code) |
| Memory that cites file and line, re-checked before use | Vendor A/B: 90% vs 83% PR merge rate | [GitHub](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/) |
| Tasks sized under the agent's reliable time horizon | Measured: about 59 minutes at 50% success, about 15 minutes at 80% | [METR](https://arxiv.org/abs/2503.14499) |

## Team collaboration around agents

- **Delegating from issue trackers.** The agent is a delegate on an issue, and a human keeps ownership. Sources: [Linear for Agents](https://linear.app/developers/agent-interaction), Devin, Cursor, Copilot.
- **Slack triggers that run on a teammate's machine** over an outbound connection ([Cursor My Machines](https://cursor.com/docs/cloud-agent/my-machines)).
- **Shared sessions that a teammate can take over** ([Amp thread sharing](https://ampcode.com/docs/collaborate/thread-sharing)).
- **Commit trailers that link a commit to its conversation**, as Amp's `Amp-Thread-ID` does.
- **Cost per person through OpenTelemetry**, which Claude Code, Codex and Gemini CLI can all export.

## What Tributary built from this

All of it is on main and described in `README.md`:
- **Copies that run:** `.worktreeinclude`, a trusted setup script, and ports for each copy.
- **The secret guard:** checks merges and commits, and redacts transcripts.
- **The review loop:** comments on diff lines, review by another agent, and conflicts resolved inside the copy.
- **Checks after every turn**, with a Fix button.
- **What needs you:** the next-chat jump, notifications only when an agent is blocked, and keeping the computer awake.

Planned next, each needing a decision first:
- team secrets with SOPS and age (a new dependency);
- MCP secrets as `${VAR}` placeholders;
- the GitHub pull request and CI flow;
- shared and handed-off sessions in project rooms;
- Slack and Linear triggers;
- running Tributary inside Zed as an ACP agent.
