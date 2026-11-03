# Tributary: how to stand out, and be easy for everyone

Research and plan, 3 November 2026. This builds on [research/2026-11-agent-workflows.md](research/2026-11-agent-workflows.md), [UX_RESEARCH_2026-11-03.md](UX_RESEARCH_2026-11-03.md) and [NEXT_FEATURE_PLAN.md](NEXT_FEATURE_PLAN.md) instead of repeating them. Statuses come from [FEATURE_STATUS.md](FEATURE_STATUS.md) and a read of the current source.

Two inputs:

- **Verified research.** A deep-research run used 5 angles and fetched 23 sources. It extracted 114 claims and checked the top 25 with three independent verifiers each: 19 held and 6 were refuted.
- **What users say.** Gathered with agent-reach:
  - Hacker News: 1,367 comments in about 1,010 threads.
  - GitHub issues: about 300 issues across eight agent and editor repositories, ranked by reactions.
  - The Cursor forum, V2EX, and 11 YouTube transcripts.
  - Reddit blocked access, so it is missing.
  - These are signals of what people raise, not measures of how common a problem is.

## The short answer

1. **"Every agent in one app" is no longer unique, so it can't be the pitch.**
   - The ACP Registry listed 44 agents on 3 November 2026, and Zed and JetBrains IDEs install from it.
   - JetBrains Air runs your own Claude, OpenAI and Google subscriptions and any ACP agent.
   - Conductor runs Claude Code, Codex and Cursor agents in parallel worktrees for free, on Macs only.
2. **The loudest pain is limits and cost.**
   - Usage limits and silent pricing changes came up more than any missing feature. The top Claude Code issue on hitting limits has about 1,500 comments.
   - Tributary is one of the few apps that holds several vendors and local models at once. It can turn that into "you're never stuck": a live cost meter, plus "continue with another agent" when one runs out.
3. **People can't judge AI by feel, so show measured results.**
   - In METR's randomized trial, developers were 19% slower with AI but believed they were 20% faster.
   - A multi-agent app is the natural place to show measured results on your own code: tests passed, edits needed, reverts, cost.
   - Over time this shows which agent is actually best for this repository, and whether one got worse this week.
4. **Beginners need help checking and fixing, not just generating.**
   - Non-developers reprompt instead of debugging, and are the only group that reports never checking AI code.
   - Prompt-to-app builders failed to deploy 16–35% of one-shot apps in one benchmark.
   - A scan of public vibe-coded apps found leaked secrets and personal data.
   - The plan is an error-loop breaker, plain-language "how to check this", safe undo without git, and a check before you share.
5. **Be safe, open and light where others aren't.**
   - Users report agents deleting drives and databases.
   - They also complain about hidden steps and system prompts, Mac-first apps, bloated desktop clients, and broken Japanese, Korean and right-to-left input.
   - Each of these can be beaten with ordinary engineering, not a new model.
6. **Aquifer is the one asset nobody else has.** It runs heavy work on a teammate's idle laptop. Put it inside Tributary as one switch.

**One-line positioning:** *Tributary keeps you working whichever AI company limits you, shows you what the agents really did, and makes the result safe to trust, whether you're a senior developer or building your first app.*

## What is already taken (verified)

| Claim | Who holds it | Confidence |
|---|---|---|
| Install and run many agents through one standard (ACP Registry, 44 agents) | Zed, JetBrains IDEs and Air | High (3-0) |
| Use your own subscriptions or API keys across vendors | JetBrains Air | High (3-0) |
| Parallel agents in isolated worktrees, free with your own keys | Conductor (Mac only; cloud workspaces are paid, Pro from $50/month) | High (3-0) |
| Per-task run environments: local, git worktree or Docker container | JetBrains Air. Tributary has no container sandbox. | Medium (2-1) |

Space that is still open, inferred from the gaps and not proven:

- Reusing the agent programs and logins already installed on macOS, Windows and Linux. The registry downloads its own adapter builds instead.
- Comparing agents by measured results.
- Teaching beginners to check what the AI made.
- A screen-reader-friendly status layer for several agents at once.
- Pooling a team's machines (Aquifer).

## What people are angry about, and what they ask for

| Rank | Professional developers' top complaints | Signal |
|---|---|---|
| 1 | Usage limits and pricing that change silently and run out fast (Claude Code, Codex, Cursor, Antigravity, Kiro, Copilot) | About 25 sources and 64 HN threads; [claude-code#16157](https://github.com/anthropics/claude-code/issues/16157) has about 1,500 comments; a Cursor thread about a plan change has 782 posts |
| 2 | Opacity and lock-in: hidden steps, a 33,000-token hidden prompt, unasked co-author lines, bans on using a subscription through other tools | About 12 sources and 69 HN threads |
| 3 | The model feels worse from week to week; inconsistency is worse than a weaker model | [claude-code#42796](https://github.com/anthropics/claude-code/issues/42796), 3,286 reactions |
| 4 | Reviewing agent output is the bottleneck, and diff views break | About 10 sources and 39 HN threads |
| 5 | Agents say "done" when the work isn't done; output is wordy and over-engineered | [claude-code#3382](https://github.com/anthropics/claude-code/issues/3382), 1,373 reactions |
| 6 | Destructive actions with no sandbox or rollback | About 8 sources (Antigravity, Claude Code, Gemini CLI, Replit) |
| 7 | Mac-first desktop apps with weak Linux and Windows support | [codex#11023](https://github.com/openai/codex/issues/11023), 1,464 reactions |
| 8 | Stuck between constant permission prompts and approving everything | About 6 sources and 34 HN threads |

| Rank | What stops beginners | Signal |
|---|---|---|
| 1 | Error loops that burn credits: the same fix tried again and again | 4 videos and 2 HN threads; matches the verified "reprompt instead of debug" finding |
| 2 | Losing track of their own app once it grows | 6 sources |
| 3 | Unpredictable credit and token costs | 6 sources |
| 4 | No safe undo, because git is assumed | [codex#9203](https://github.com/openai/codex/issues/9203), 545 reactions |
| 5 | Deployment, hosting and databases | 5 sources; 16–35% of one-shot apps failed to deploy (verified, low confidence) |
| 6 | Security unknowns: secrets, auth, exposed data | 5 sources; the vendor scan of public apps (verified, low confidence) |
| 7 | Jargon, the terminal and setup | 5 sources |
| 8 | Generic output: "make it prettier" replaces the whole style | 4 sources |

Most-wanted features:

1. One shared set of rules for all agents: AGENTS.md, skills, MCP. [claude-code#6235](https://github.com/anthropics/claude-code/issues/6235) has 6,690 reactions, the most in that repository.
2. Bring your own model or a local model, routed per task.
3. Checkpoints that rewind the code and the chat together.
4. Keep or reject each hunk in a review.
5. Parallel agents with one dashboard.
6. A live usage meter in money, not tokens.
7. Phone or remote notification when an agent needs you.
8. Switching between work and personal accounts ([claude-code#18435](https://github.com/anthropics/claude-code/issues/18435), 1,270 reactions).

## The six bets

Status: **Have** means shipped. **Partial** means a foundation exists. **New** means not started.

### A. Never stuck on one vendor (limits, cost, accounts)

Why: this is the top complaint by a wide margin, and only a multi-vendor app can solve it.

| Feature | What the person sees | Status |
|---|---|---|
| Usage meter | Today and this week, per agent: money for API keys, and the share of a subscription window where the agent reports it (Claude's stream already sends rate-limit events). Optional daily and weekly caps with a warning at 80%. | Partial: per-turn cost when the provider reports it |
| Continue elsewhere when a limit hits | "Claude reached its limit. Continue with Codex or your local model?" Carries the handoff summary. Says plainly if the data destination or price changes, and asks first. | Partial: handoff exists; limit notices are parsed but not acted on |
| Cheap work goes to cheap models | Per role: reviewer, summarizer and subagent can use a local or open-weight model (Qwen, DeepSeek, GLM, Kimi) through the existing gateways | Partial: gateways exist; routing (A01) not built |
| Several accounts per agent | Work and personal profiles per agent, using each CLI's own config directory, switchable per project | New |
| Show hidden overhead | How many tokens each agent sends before your message, measured from the first turn's usage | New |

How we'll know it works: the share of limit hits that end in a finished task without the person leaving Tributary, and fewer "surprise bill" reports.

### B. Proof instead of vibes

Why: METR's perception gap (verified), review as the bottleneck, and agents saying "done" when they aren't.

| Feature | What the person sees | Status |
|---|---|---|
| Turn receipt | Under each reply: what was asked, the files changed, commands run, checks run with results, and anything claimed but not checked | Partial: per-turn change provenance exists |
| Check after every turn | Runs the project's checks (tests, type check, lint) after each turn that edits files, and flags "said done, checks fail" prominently | Partial: race mode runs tests; project checks are documented |
| Keep or reject each hunk | In the review panel and the editor, for every agent | Partial: undoing one agent's hunk exists |
| Your repository's scoreboard | Per agent, on your own tasks: checks passed, edits you had to make, reverts, cost and time. Warns when an agent's results drop compared with last week. | New. Only possible in a multi-agent app. |
| Second opinion in one click | "Have Codex review Claude's change", with the extra cost shown first | Partial: the build-and-review team and race judge exist |

How we'll know it works: the share of editing turns with checks run, time from reply to accepted change, and revert rate.

### C. Safe by default

Why: destructive-action reports, beginners without git, and Air's container sandbox.

| Feature | What the person sees | Status |
|---|---|---|
| Destructive-command guard | Deleting outside the project, dropping a database, force-pushing main or wiping a home folder always asks, with a plain explanation, whatever the mode | Partial: approve or deny exists for ACP agents |
| Graded permissions | Presets between "ask for everything" and "approve everything", such as "edit this project freely, ask before network and installs, never touch anything outside it" | Partial: access modes exist |
| Rewind code and chat together | One step back restores the files and the conversation to the same point | Partial: git checkpoints for code |
| Undo without git | Hidden snapshots for folders that aren't git repositories | New (C04) |
| Container sandbox | Run Full auto inside Docker, reusing Aquifer's sandbox package. Off by default, recommended for Full auto. | New. Aquifer already has the sandbox. |

How we'll know it works: no unrecoverable losses reported, and the share of Full-auto runs inside a sandbox or worktree.

### D. A beginner path that teaches checking, not only generating

Why: the verified beginner research (reprompting, never checking, design recommendations for scaffolding) and the beginner blockers above. Everything here sits behind a simple mode, so experts never see it.

| Feature | What the person sees | Status |
|---|---|---|
| Setup without a terminal | Finds, installs and signs in to agents from the app, or starts with a free local model or one account | Partial: registry install and guided gateway setup |
| Example project | A labeled sample that produces a working result with no charges | New (G04) |
| Error-loop breaker | After the same error twice, the agent stops. It says in plain words what is going wrong and suggests a different approach, a different agent or what to check. It shows what the retries have cost. | New |
| "How to check this" | Each change ends with what changed, how to try it, and what the agent isn't sure about | New. Matches the research's recommendation to signal uncertainty. |
| Check before sharing | Before deploying or sharing: scans for secrets, open data and missing sign-in, with a plain checklist | Partial: team secrets and secret handling exist |
| App map | One screen showing the pages, data and where each lives, updated as the agent works | New |
| Keep my style | A project look file (colors, type, spacing) that every agent follows, so "make it prettier" keeps the style | New |
| Point at the preview | Click an element in the live preview to say "change this" | Partial: the preview panel exists |
| Guided deploy | Deploy through Vercel, Netlify or Cloudflare's own CLIs, with the check above first | New |

How we'll know it works: a non-programmer gets a first working app in under 15 minutes, there are fewer repair loops per task, and more beginners run a check before sharing. Test with real beginners. The research only gives recommendations; no trials were found.

### E. Open and light

Why: opacity, resource bloat, and the most-reacted request for shared rules.

| Feature | What the person sees | Status |
|---|---|---|
| Nothing hidden | Every file read and command run is listed by name, in plain language | Partial: tool activity exists |
| One set of rules for every agent | A Rules screen showing AGENTS.md, skills and MCP servers, and which agent follows which | Partial: shared memory, merged skills and multi-agent MCP add exist |
| What leaves this computer | Per agent: where data goes and what is kept | Partial (Q04) |
| No surprise trailers | Tributary adds none, and can remove co-author lines agents add | New |
| Published resource budget | Idle memory and CPU targets checked in CI, bounded logs, and child processes cleaned up | Partial: performance gates exist |

### F. For everyone, on every machine

Why: Mac-first competitors, the verified accessibility study, input-method and right-to-left bugs, regional access, and low-end laptops.

| Feature | What the person sees | Status |
|---|---|---|
| Linux and Windows treated like macOS | Tested installers and updates; Wayland, input-method and path tests in CI | Partial: AppImage, deb, dmg and NSIS targets exist (G03) |
| Accessible status for many agents | One announcement queue with scope ("Codex changed 3 files"), Do Not Disturb with status on demand, a short summary before long output, and consistent shortcuts | Partial: live regions in 5 components |
| Languages | Translated interface, an input-method-safe composer (Japanese, Korean, Chinese) and right-to-left layout | New (X03) |
| Regional and local models | Ready presets for DeepSeek, Qwen, GLM and Kimi, plus a "will this run well here" check that explains memory, context size and speed honestly | Partial: gateways exist |
| Low-end laptops | One switch in Tributary runs dev servers, tests and builds on a teammate's idle machine through Aquifer | New. Aquifer and its JSON output exist. |
| Phone and remote | A phone notification when an agent needs approval or finishes; SSH remote hosts | Partial: SSH remote mode shipped |

## Order of work

**Now, the next 2 to 3 weeks.** These are the strongest signals and mostly reuse existing pieces:

1. Usage meter, and "continue elsewhere" when a limit hits (A).
2. Turn receipt, plus checks after every editing turn with the "said done, checks fail" flag (B).
3. Destructive-command guard and graded permission presets (C).
4. Error-loop breaker and the "how to check this" summary (D).
5. Accessible status queue and Do Not Disturb (F).

**Next, 1 to 2 months:**

6. Keep or reject each hunk everywhere; rewind code and chat together; undo without git.
7. Your repository's scoreboard, with week-on-week warnings.
8. Setup without a terminal, the example project and simple mode.
9. Several accounts per agent; cheap and local models per role.
10. The Aquifer switch inside Tributary; phone notifications.

**Later, this quarter:**

11. Container sandbox, check before sharing, app map, keep my style, point at the preview, guided deploy.
12. Translated interface and right-to-left layout; certified Windows and Linux releases.

Before starting the Later items, run 8 short sessions with real people: 3 beginners, 3 professional developers and 2 screen-reader users. The beginner and accessibility evidence is thin.

## What not to build

- Our own model or coding agent. Integrate instead.
- Cursor-style Tab completion and a cloud code index. These are expensive, and Cursor and Zed already do them well.
- A hosting platform. Use the providers' own CLIs.
- Reselling AI subscriptions.

## Risks

- **Vendor terms.** Vendors have blocked third-party tools from using subscriptions, and changed access overnight. Tributary should only drive each agent's official program with the person's own sign-in. It must never copy tokens or impersonate a client, and it should always offer API keys or local models as a fallback. Watch each vendor's terms.
- **Overlap will grow.** Air, Zed and Conductor will add more. The lasting edge is continuity across vendors, measured results, beginner checking and Aquifer, not the agent list.
- **Thin evidence in places.** No verified evidence covers Cursor, Windsurf, Copilot agent mode, Claude Code desktop, the Codex app, Kiro, Antigravity, Warp, Lovable or v0 positioning. The same is true for non-English users, low-end hardware and local-model quality. Reddit was not reachable. Treat those parts of the plan as hypotheses to test.
- **Out of date quickly.** METR's study used early-2025 tools, the app-builder benchmark predates Bolt v2, and pricing pages change often.

## Sources

Verified (deep research):

- ACP Registry: [zed.dev/blog/acp-registry](https://zed.dev/blog/acp-registry) and the [live index](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)
- JetBrains Air: [quick start](https://www.jetbrains.com/help/air/quick-start-with-air.html), [agents](https://www.jetbrains.com/help/air/ai-agents.html), [run environments](https://www.jetbrains.com/help/air/run-environments.html)
- Conductor: [home](https://www.conductor.build/), [pricing](https://www.conductor.build/pricing), [cloud FAQ](https://www.conductor.build/docs/cloud/faq)
- Stack Overflow 2026 survey: [results post](https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/), [AI section](https://survey.stackoverflow.co/2026/ai). About 80% use two or more AI tools a week; Claude Code (65.5%) and Copilot (58.7%) lead (2-1 vote).
- METR: [2025 study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/), [2026 update](https://metr.org/blog/2026-02-24-uplift-update/)
- Beginners: [Sarkar and Drosos](https://arxiv.org/pdf/2506.23253), [Fawzy, Tahir and Blincoe](https://arxiv.org/html/2605.24521), [prompt-to-product deployment benchmark](https://arxiv.org/html/2512.18080), [Escape scan of vibe-coded apps](https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/) (vendor study)
- Accessibility: [Chen et al., screen-reader developers and AI assistants](https://arxiv.org/abs/2506.13270v2)

Refuted, so don't repeat these:

- Air resells several vendors under one bill as its main pitch.
- JetBrains co-wrote the registry spec.
- Conductor matches Tributary's review, PR and merge flow.
- "93% need source attribution" from the Stack Overflow survey.
- Escape's specific claims about Supabase keys and Row-Level Security as the causes.

What users say (signals, not prevalence): the issues and threads linked in the tables above. They come from Hacker News (Algolia API), GitHub issues ranked by reactions, the Cursor forum, V2EX and YouTube transcripts, all from January 2025 to 3 November 2026.
