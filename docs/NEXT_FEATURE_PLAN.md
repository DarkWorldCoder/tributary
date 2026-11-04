# Tributary: next feature plan

Prepared 3 November 2026. This is a proposed implementation sequence, not a list of shipped features.

## Current foundation

The current working tree includes chat-driven background delegation, Manager task assignment with dependencies, isolated conversation working copies, worker cards, Live activity, explicit review/merge, LAN room hosting from the UI, attachments and image previews, and four terminal docking positions. These changes are local and uncommitted. The latest full regression run passed 204 tests; later delegation stop/recovery checks also passed. Native checks used fake agents, not paid provider calls or a packaged cross-platform release.

Current boundaries verified in source:

- Chat delegation has start/list/status/stop commands, two active workers per parent and four new workers per turn. It has no worker messaging command or durable execution queue. Workers cannot spawn further workers.
- Manager dependencies and result handoffs exist, but ordinary delegated chats and shared room tasks do not yet form one coordinated job graph.
- Workers start from the project's committed baseline. Uncommitted parent edits are not copied. App exit interrupts work; execution does not automatically resume.
- File drafts survive session navigation, but the current session map is not restart recovery.
- Project memory has bounded lexical retrieval, revisions and opt-in context sharing. Structured memory items, expiry and source invalidation remain separate work.
- The editor supports syntax, formatting and change review. A complete language-server project intelligence layer is additional work.
- Rooms coordinate tasks and invitations. They do not synchronize source trees or execute teammates' agents remotely.

Older status documents describe earlier snapshots. Use current source and the newer delegation/room notes when reconciling them.

## Phase 1: protect work and finish the agent workflow

| Order | Feature | User experience | Completion check |
| --- | --- | --- | --- |
| 1 | Draft and layout recovery (implemented 3 November 2026; queued messages and attachments remain) | Reopen the same files, unsaved edits, selected chat and panel layout. See a clear recovery choice after a crash. | Force-close with dirty files; restart; recover exact text. If disk content changed, compare both versions without overwriting either. |
| 2 | Durable background job queue | Queued, running, waiting, blocked, ready to review, failed, cancelled and interrupted states in one Jobs view. Resume eligible work deliberately. | Persist before process launch; simulated crashes at each transition cause no duplicate launch or merge. Reconcile surviving processes; retain outputs. Never claim unsupported provider sessions can resume. |
| 3 | Review desk | One screen for each worker's task, branch, changed files, explanation, checks and merge readiness. | Every diff points to its actual before/after revision and originating turn. Failed or skipped checks are visible. Recheck the target revision before applying. Preserve unrelated edits and current merge protections. |
| 4 | Worker inbox and steering | Tell a worker “use this API”, request a status update or give it another task from the parent chat. | Persist message IDs and acknowledgements; deduplicate retries; enforce parent/child scope. Deliver at supported adapter boundaries. Queue instructions for adapters that cannot safely accept them mid-turn. |

Implementation boundaries:

- Extend the existing SQLite store and Hub; avoid a second authoritative job database.
- Persist job ID, parent/child IDs, project, workspace/base revision, chosen agent/model, permission mode, dependencies, attempts, timestamps, process ownership and output references.
- Keep provider resume separate from retry. A retry may repeat external actions; require a deliberate decision when completion is uncertain.
- Use version checks and transactions for claims/state changes. Do not trust a reused process ID as proof that the original worker is alive.
- Draft storage belongs in private app data, with retention/size limits and explicit clearing. Restore terminal placement, not a claim that the former shell process was recovered.
- Explain why a change was made using task/tool evidence. Mark model-generated explanations as explanations, not verified intent.

## Phase 2: coordinated teams developers can understand

| Order | Feature | User experience | Completion check |
| --- | --- | --- | --- |
| 5 | Unified task graph | Parent chats, Manager pieces and room tasks share visible ownership, dependencies and blocked reasons. | Atomic claims, cycle checks, idempotent completion and expired-owner recovery. A disconnected teammate cannot silently retain an active claim forever. |
| 6 | Agent roles and model presets | Save a team such as Planner / Frontend / Backend / Reviewer, with a supported model for each role. | Validate current capabilities and model support before launch. Show effective permissions and fallback choices; never silently change provider or privilege. |
| 7 | Usage and execution limits | Set concurrency, time, turn and retry limits; see actual provider-reported usage where available. | Enforce limits across a job and its descendants. Monetary estimates are labelled; do not promise an exact currency cap without reliable provider metering. |
| 8 | Project map and file timeline | Find entry points, symbols, references, related tests and which agent changed a file. | Start with paths/symbols/tests and source links, then add language-server adapters. Label heuristic relationships. Local history can compare/restore saved versions independently of agent checkpoints. |
| 9 | Structured project memory | Small cards for decisions, conventions and open questions, with source, scope, pin, edit, forget and expiry. | Track source revisions; flag stale facts. Removing an item invalidates derived retrieval data. Summaries retain unresolved work and source links within a measured context budget. |

Suggested data contracts:

- A shared task owns its assignee and dependency graph; a local job owns its execution. A room assignment does not grant remote command execution.
- Messaging supports progress, question, result, instruction and stop-request types. Bound payloads and transcript inclusion; avoid unbounded all-to-all broadcasts.
- The planner proposes a graph; the scheduler enforces it. Worker-reported “done” is distinct from checks passed and human merge approval.

## Phase 3: teams and everyday users

| Order | Feature | User experience | Completion check |
| --- | --- | --- | --- |
| 10 | Room results and review handoff | Attach a local job's result, test evidence and patch to its shared task; a teammate can review it. | Include base revision and attribution; validate patch paths and size. No keys, private memory or absolute local paths in shared results. Conflicts remain explicit. |
| 11 | Simpler Host / Invite / Join | Pick an existing project, host, invite, verify connection and see online teammates. | Test two physical computers, discovery failure, network change, revoked/expired invitations and host restart. Presence and durable task ownership are separate states. |
| 12 | Document workspace | Import PDF/DOCX, extract readable text, show source pages and export supported results. Add OCR explicitly where needed. | Label extraction failures, scanned pages, size limits and unsupported formats. Treat document content as reference data; never execute embedded content. Verify exported artifacts in their intended viewers. |
| 13 | Useful connector setup | Search available apps/tools, connect an account, test it and see which agent can use it. | Implement one complete connector at a time. Verify discovery, authorization, capability compatibility, disconnect and expiry. Configuration alone never means tools are usable by every agent. |
| 14 | Everyday / Developer modes | Everyday: task, materials, result. Developer: files, changes, jobs, terminal. A short first-run checklist and sample workspace. | New users can open a project or document and complete a task without learning Git or MCP. Example mode sends no paid request without a clear action. Keyboard and small-window paths remain complete. |

Later candidates: reusable task recipes, explicit scheduled runs, voice input, localization, named layout presets, split terminals and editor groups. Each needs its own persistence and failure behavior, not just a new button.

## Performance and delivery gates

- Record p50/p95 startup, agent-launch overhead excluding inference, file-tree update latency, editor interaction latency, idle CPU/RSS and long-chat scroll behavior on fixed fixtures.
- Prefer bounded history rendering, incremental search/indexing, deduplicated watchers and existing compiled Git/ripgrep/SQLite paths before adding another runtime.
- Consider Rust for a measured indexing/hashing bottleneck only after comparing a worker-based implementation and accounting for packaging/cross-platform costs. A language bridge does not reduce remote model latency.
- Every phase requires focused unit/integration checks, TypeScript and a production build. Exercise native UI at 320, 390, 768, 900, 1280 and 1920 px for affected surfaces.
- Before calling a release ready, test packaged Linux/macOS/Windows launch, restart, update rollback, permissions and host shutdown separately from development-mode checks.

## Build order and first delivery

Start with draft recovery, then the durable job queue, then the review desk and worker inbox. They make existing background agents dependable and understandable. Build the shared task graph next; only then connect local outcomes to room tasks.

Keep controls in existing surfaces: Jobs within Live activity, worker cards in chat, review within Changes, memory cards in Memory and terminal placement in its own toolbar. Prefer short labels and expandable detail over permanent explanatory paragraphs.

A same-file collaborative editor is a later, separate project. If justified, prototype text synchronization and offline convergence with an established CRDT layer, plus authorization, save ownership and Git conflict rules. Presence alone is not file synchronization, and a converged text buffer does not prove the resulting program is correct.

## Research references

These sources inform the proposed patterns; they do not prove Tributary implements them.

- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams): independent contexts, shared tasks, messaging, team overhead and limitations. The documented headless-mode boundary matters: Tributary needs its own coordination bridge rather than assuming native interactive teams appear in every CLI run.
- [VS Code source history](https://code.visualstudio.com/docs/sourcecontrol/history): separate repository history, file timeline and line attribution.
- [VS Code local history](https://code.visualstudio.com/docs/editing/getting-started/userinterface#timeline-view): version comparison and restoration as a focused file workflow.
- [Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness) and [offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing): ephemeral presence and persisted collaborative document state have different lifecycles.
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture): distinguish discoverable tools, resources and prompts; verify the protocol version supported by each adapter before implementing a bridge.

Research route: the agent-reach Exa backend was unavailable; official pages were checked with the built-in web tool instead. No public user study or paid-agent benchmark was performed for this plan.
