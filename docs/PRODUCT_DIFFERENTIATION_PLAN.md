# Tributary: understand, build and verify work

Research date: 3 November 2026. Planning horizon: the next 90 days, subject to team capacity.
Status: product recommendation and proposed work, not a claim that the roadmap is delivered.

## Executive read

Tributary should help people finish work they can understand and verify, across their preferred assistants.
Multiple providers, background agents and a familiar editor are useful foundations, but competitors already offer overlapping capabilities.
The strongest opportunity to validate is continuity from a request through decisions, changes, evidence, review and recovery.
QA engineers belong in that workflow as users who define expected behavior and evaluate results, not only as agents that write tests.
A beginner should be able to start from a goal or URL; a developer should be able to inspect exact files, branches and commands.
The same project record should support both without exposing every advanced control at first use.
This direction is a hypothesis based on source review, public documentation, a developer survey and a small number of public discussions; it needs customer validation.

## Audience and relationship to the existing roadmap

The [everyday-user roadmap](PRODUCT_ROADMAP.md) remains relevant: simple task entry, materials, useful results and continuity across assistants.
This plan adds a focused engineering-team pilot rather than silently replacing those audiences.

| Audience | First useful task | Default surface | Optional detail |
| --- | --- | --- | --- |
| Beginner / learner | Explain or improve something, then inspect the result | Chat, materials, preview, plain-language changes | Files, commands, Git |
| Developer | Change a feature and verify the diff | Editor, chat, changes and checks | Debugger, worker graph, language tools |
| Manual QA engineer | Test a flow from requirements and capture a reproducible bug | App preview, test checklist and evidence | Code / selectors |
| Automation QA / SDET | Reproduce a failing run and maintain a reviewed regression test | Test results, trace, test source and branch | API, fixtures, CI adapters |
| Team lead | See what is blocked and what is ready for review | Task ownership, evidence and release gaps | Agent budgets / dependency graph |
| Everyday knowledge worker | Research or prepare a source-grounded document | Task, materials and editable result | Provider / tool configuration |

Recommend recruiting an initial pilot of small teams with mixed developer and QA experience. Do not market universal suitability before testing those workflows.
The detailed QA proposal is in [QA_WORKSPACE_RESEARCH.md](QA_WORKSPACE_RESEARCH.md).

## What the market evidence establishes

| Source | Observed capability / finding | Consequence for Tributary |
| --- | --- | --- |
| [Zed external agents](https://zed.dev/docs/ai/external-agents) | Runs external agents through ACP; agent configuration and authentication have runtime-specific boundaries | Provider choice alone is insufficient differentiation; expose capability and approval differences clearly |
| [OpenCode agents](https://opencode.ai/docs/agents/) | Primary agents, subagents and permission-limited planning are documented | A team button or Plan mode is an expected capability, not a unique product proposition |
| [Cursor agent overview](https://cursor.com/docs/agent/overview) | Agent execution and coordination are part of its product surface | Compete on clarity and verified outcomes, not the number of concurrent workers |
| [Kimi custom agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents) | Custom agent behavior and background task lifecycles are documented | Keep adapters faithful to actual runtime behavior |
| [VS Code review](https://code.visualstudio.com/docs/agents/run/review-code-edits) | Review and reversion of agent edits are already supported | Tie our review to task intent and actual checks, while retaining exact file navigation |
| [Replit Agent](https://docs.replit.com/features/agent/overview) | Natural-language app building is already an established entry point | Plain-language creation is necessary, but needs useful review and recovery |
| [Stack Overflow 2026 survey](https://survey.stackoverflow.co/2026/ai/data/ai-trust) | 48% of 14,304 respondents chose trusting AI when they can easily verify its output | Strong directional support for making verification easy; this developer sample does not establish QA-specific demand |
| [CooperBench, January 2026](https://arxiv.org/abs/2601.13295) | Studies coordination failures in over 600 collaborative coding tasks across 12 libraries and four languages | Evaluate isolation, commitments and integration, rather than assuming extra agents improve outcomes |
| [Anthropic agent design guidance](https://www.anthropic.com/research/building-effective-agents) | Recommends simple designs and increasing complexity when the task needs it | One assistant by default; delegation is an explicit, bounded option. This is older design guidance, not a current feature comparison |

These are a selective comparison and vendor-documented capabilities, not a complete market census, independent product benchmark or proof of uniqueness.

## Ranked UX problems

Severity describes impact if the problem occurs. Frequency describes evidence strength, not invented market prevalence.

| Rank | Problem / user goal | Surface and failure | Evidence / frequency signal | Severity | Confidence | Product move |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Know whether a result is correct | Chat says complete while checks, scope or integration remain unclear | Survey supports conditional verification; repeated project screenshots show fragmented activity. Actual incident prevalence unmeasured | High | High problem relevance; medium proposed solution | A linked work record with exact edits, actual run results and remaining gaps |
| 2 | Continue without losing work | View resets, file reloads, interrupted drafts and provider handoff interrupt progress | Repeated user reports in this project; no external frequency estimate | High | High local relevance | Stable project sessions, protected drafts, explicit reload and recovery |
| 3 | QA can test without becoming an agent operator | Editor-first controls hide requirements, expected outcomes and evidence | Existing local surfaces focus on files/chat; QA tools already give cases and run reports first-class treatment | High | High gap in local source; demand needs interviews | A Test workflow usable with a URL and no repository |
| 4 | Understand what another agent changed | Long activity streams disconnect task intent from source changes | [Cursor discussion](https://forum.cursor.com/t/how-to-navigate-to-the-changes-made-in-chat-to-accept-or-reject-them/145639) illustrates review navigation friction; a single dated anecdote | Medium–high | Medium | Summary → file → hunk → why → checks, with next/previous change |
| 5 | Predict permissions and provider behavior | Repeated prompts or missing tools confuse the user after switching agents | [Zed discussion](https://github.com/zed-industries/zed/discussions/57402) illustrates external-agent approval boundaries; anecdotal, not prevalence data | Medium–high | Medium | Visible provider capability card; approvals at their real conversation position |
| 6 | Coordinate without conflicts or overload | Workers lack ownership, dependencies and an integration definition of done | CooperBench provides a benchmark-specific coordination caution, not a guarantee about all tools | High | High risk relevance | Clear assignments, limited concurrency, isolated edits and integration evidence |
| 7 | Start a useful task quickly | Too many modes, connection terms and crowded controls | Local screenshot/source inspection; no measured onboarding baseline yet | Medium | Medium | Goal-first onboarding; reveal advanced controls only when needed |

## Product concept to validate: one work record

Each task links:

`Request → expected outcome → plan → actual actions → changed files/results → evidence → human review → recovery`

| Record | Required behavior |
| --- | --- |
| Intent | Capture what the user wants and explicit acceptance criteria; retain original wording |
| Plan | Distinguish a proposed step from a dispatched or finished step |
| Actions | Actual tools, approvals, files and errors in conversation order |
| Changes | Exact branch/workdir, real +/− counts, hunks and direct editor links |
| Explanation | Agent-proposed reasons tied to those edits, visibly distinct from measured facts |
| Verification | Real command/run, exit code, environment, timestamp and artifacts; “not run” stays visible |
| Review | Separate ready for review, accepted, rejected and merged states |
| Recovery | Protected drafts and reversible changes; disclose conflicts rather than overwrite them |

This builds on existing chats, files, review, checkpoints, delegation and project checks. It needs a shared task/evidence schema rather than another disconnected dashboard.

## What to add, and what to defer

| Priority | Add | Definition of done |
| --- | --- | --- |
| P0 | Reliable workspace and browser preview | No page reload on tool switching; address errors recover; Start/Stop refer to owned processes only |
| P0 | Reviewable task results | A user can identify exact changes and the checks actually executed |
| P0 | QA test runs and bug evidence | First implementation slice in the QA plan; generated tests never count as executed |
| P1 | Project understanding | File/symbol map linked to real index data; Explain change grounded in actual diff |
| P1 | Provider handoff | Capability-aware, bounded summary including pending approvals, tests and decisions; no claim that unsupported tools transferred |
| P1 | Bounded teams | Named owner, assignment, dependencies, stopped/failed/skipped states and integration checks |
| P1 | Simple onboarding | Pick a goal, connect one assistant if needed, open materials/project/URL, get one useful result |
| P2 | Budget controls | User limits for elapsed time, workers and known spend; unknown usage never shown as zero |
| P2 | Richer integrations | Test results, issue trackers, CI and research sources through narrow adapters |
| Later | Native/mobile testing, broad extension execution, full peer file sync | Validate demand and the host/security design separately |

Do not make Rust/Zig rewrites, unrestricted extension execution, automatic agent swarms or an arbitrary “AI confidence score” prerequisites. Profile resource problems before choosing another runtime.

## Opportunity map and release gates

| Window | Work | Exit gate |
| --- | --- | --- |
| This week | Finish current preview/activity stability; inventory every visible control; collect onboarding baseline; validate QA workflow with sample traces/cases | No false done states, no draft loss in exercised flows, buttons have real outcomes |
| Weeks 2–4 | Work record + manual QA case/run model + reproducible bug bundle; existing Playwright result import | QA can reproduce, capture, hand off and retest a seeded failure |
| Weeks 5–8 | Reviewed test generation, traces, CI import, ownership/dependencies and bounded test/fix/retest loop | A product defect cannot disappear through weakened assertions or unreviewed baseline updates |
| Weeks 9–12 | Pilot refinement, accessibility, platform shortcuts, release checklist and provider capability parity | Users finish target workflows unassisted; unresolved capability gaps remain explicit |
| Deeper research | Offline model suitability, enterprise access, native/mobile, research artifacts and full code collaboration | Evidence of demand and a separate technical feasibility assessment |

These are sequencing ranges, not delivery promises; re-estimate after selecting team capacity and adapter scope.

## Validation plan

- Recruit 5–6 participants per initial segment: manual QA, automation QA and developers/beginner builders. This is qualitative discovery, not a statistically representative survey.
- Observe the same tasks in their existing workflow and Tributary; counterbalance order and use equivalent seeded defects.
- Ask users to explain a change, identify a failing assertion, capture a bug, recover a draft and resume a handed-off task.
- Measure unassisted completion, time to first accepted result, evidence completeness, recovery success, false-green rate, repeated-context work and cost per accepted task where usage is available.
- Set numerical release targets only after a baseline. Treat any initial goals as hypotheses, not achieved benchmarks.
- Test keyboard-only navigation, screen readers, long names, high zoom, offline/error states and widths 320/390/768/900/1280/1920.

## Research boundary

Reviewed current public product documentation, the 2026 developer survey, one agent-coordination paper, two public discussions and the local repository/screenshots. No customer interviews, private support data, paid competitor sessions, performance comparison or exhaustive market scan were performed. The public discussions are illustrative anecdotes. The current checkout contains parallel uncommitted work, so file presence alone is not release certification.
