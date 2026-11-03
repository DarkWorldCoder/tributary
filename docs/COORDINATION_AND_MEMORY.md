# Coordination, memory and live file views

Implemented 2 November 2026. See [FEATURE_STATUS.md](FEATURE_STATUS.md) for every general-user roadmap candidate and its current boundary.

## Memory that survives assistant switches

The Memory panel now supports revision-checked saves, source-line search, a work-log tail, and twenty previous versions saved by Tributary. A conflicting save fails while preserving the draft. Previous versions load as editable drafts; saving restores the chosen content. Drafts survive switching workspace tabs within the current app session.

Notes remain ordinary project files under `.tributary`. App writes use a lock and atomic replacement, reject symlinked state paths, and limit the notes file to 256 KB. A crash may leave `memory.lock`; after confirming no process is saving, remove that lock and retry. Arbitrary external editors do not honor Tributary’s lock, so this is not an OS-wide transaction or protection from a hostile concurrent filesystem change. History snapshots cover app saves, not every direct edit an agent makes. The previous-version limit prunes older snapshots.

An app-owned `.tributary/.gitignore` excludes history snapshots, prompt-sharing settings, locks and temporary files from normal new Git additions. Notes and the shared work log remain project files. Ignore rules do not remove anything already tracked by Git.

**Include relevant notes in assistant messages** is off by default. Turning it on sends ranked note excerpts to the selected assistant/provider, with a 2,000/4,000/8,000-character budget. Matching words and important note sections determine ranking; this is deterministic retrieval, not embeddings or model-generated compaction. Search filters to matching saved lines, and a response records which source lines were included. No note excerpt is automatically sent to another project. Work-log reads are bounded to the recent tail.

Turning sharing off stops future additions. It cannot retract past prompts, erase native agent sessions, or prevent a coding assistant from reading files it already has permission to access. Deleting a note does not erase older version files or earlier model requests. Personal semantic memory, expiry, stale-fact detection, comprehensive deletion and learned summaries remain future work.

Handoff transcript digests now enforce their character budget while preserving a portion of the original request and the latest context. User requests and working-tree information are additional prompt sections; this is not a guarantee about the model’s total token window.

## Team coordination and recovery

Team recipes validate all selected roles, availability, repair-round bounds and distinct council members before any step runs. A text-only connection cannot be a file-editing builder. Builders retain the existing edit/full access behavior; planners and reviewers run read-only. These are sequential recipes; Race remains the separate isolated-worktree workflow.

Only an exact final verdict line can approve a review. An unclear verdict pauses the workflow for attention rather than triggering speculative repair loops. The last twenty team runs per conversation persist their selected roles, step states, outcomes and failures. Open Team to inspect recent records. A recorded running process that no longer exists is shown as interrupted. A live PID does not establish that an execution is healthy; PID reuse and cross-machine ownership require durable leases in a future server design.

No team action is replayed automatically after a crash. Agent commands can have effects outside the database, so a persisted record alone is insufficient to guarantee safe resume or exactly-once execution. Team-run history is local conversation state; the shared project room’s task board remains a distinct server-owned coordination record.

## See changes while an agent works

The default desktop layout keeps chat beside a dedicated right-hand workspace. Its four tabs are **Files · Changes · Memory · Preview**. Changes groups working-tree differences and conversation activity rather than placing competing navigation in the main conversation header. Memory shows readable notes first, with Edit, collapsed settings/history, and brief hover/focus help. This uses the beside-conversation pattern described in [Claude’s artifact documentation](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them), with source review informed by [VS Code’s change views](https://code.visualstudio.com/docs/sourcecontrol/overview).

Changes supports a filename/status filter, readable added/modified/deleted/renamed labels, unified or side-by-side comparison, before/after line numbers, copying the patch and opening a file. It refreshes the working tree and selected diff every three seconds while open. The comparison renders up to 2,000 diff lines; patch metadata is collapsed. Untracked binary/large files get an honest notice, and staged files in an uncommitted new repository are still shown. Git status uses NUL-separated records so spaces, Unicode, newlines and rename destinations remain intact. This is a read-only diff viewer, not a three-way merge editor or per-hunk staging UI.

Open a file in Files. Unmodified views refresh when that file changes, including atomic replacements used by many editors. If you have an unsaved draft, Tributary preserves it and shows a disk-change message instead. Saves still use the existing stale-file check. A deleted/unavailable file retains its displayed text with a status message.

Each live view watches up to twenty-four open files, prioritizing the active file, plus top-level directory changes. Native filesystem notifications provide prompt updates; two-second stat polling backs them up for missed events and network mounts. Deep unopened folders are not recursively monitored, and this does not index all file contents. Refresh files reconnects the watchers. Watchers are released on view disposal or app shutdown. Network filesystems may add their own latency; there is no zero-lag guarantee.

This view observes the files the local app can access. It does not stream an agent’s editor cursor, merge someone else’s branch or replicate source files to another computer. Same-network rooms are described in [PROJECT_ROOMS.md](PROJECT_ROOMS.md); source synchronization remains separate work.

## Connector visibility

**Settings → Connections → Check configuration** inventories saved model connections and the installed assistants’ configured MCP servers. It reports unsupported gateway combinations and unreadable configuration, omits credential values, and distinguishes configured from tested. It never calls an MCP tool or sends a model request. Codex inventory uses the installed CLI’s listing command; it does not run a configured MCP server command. The existing explicit Test connection action sends a small model request and can use paid credits.

MCP tools are supplied through a capable installed assistant’s MCP client. Direct text assistants do not gain browser, filesystem, email or MCP execution from this screen. Native Google Drive, Slack, email and calendar account authorization, scoped tool discovery and reviewed outbound actions remain unimplemented app features. Configuring an external MCP server does not prove that its login, permissions or tools work.

## Research and engineering decisions

- [Anthropic’s multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) discusses explicit delegation, effort allocation, observability and reliability. Tributary applies this through validated roles, bounded loops and recorded steps. That article’s research-agent results do not establish coding-speed gains here.
- [Anthropic’s context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) emphasizes selecting useful context instead of accumulating everything. This pass adds bounded retrieval and source attribution; semantic summarization remains a separate evaluation task.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) distinguishes thread checkpoints from cross-thread stores. Tributary retains that distinction between conversation/team state and project notes without adding a new orchestration framework. Persisting state does not authorize replaying external effects.
- [MCP’s versioned host/client/server architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture) describes client isolation and capability boundaries. The app keeps native-agent tools separate from text-only connections. This pass does not implement a new MCP protocol client or claim every server capability is available.

## Evidence and limits

Tests exercise stale saves, version retention, symlink/size rejection, actual opt-in memory delivery to a fixture model request, strict digest budgets, pre-execution role validation, persistent failed/uncertain team records, redacted diagnostics, native file events, polling fallback and verified HTTPS service requests. Existing live-client tests cover independent users, competing task claims, replay, reconnect and revocation. Fixture tests do not call paid models.

Actual Electron checks verified an external write refreshing a Markdown preview and an external conflict preserving an unsaved draft. Memory save/search, right-hand tab placement, file comparisons and connector diagnostics were exercised with an isolated profile. Screenshots: [right-hand workspace](performance/workspace-right-panel.png), [side-by-side changes](performance/file-changes-side-by-side.png), [live file view](performance/live-file-updates.png), [memory](performance/project-memory.png), [connectors](performance/connector-diagnostics.png).

No second physical computer, real network mount, production deployment or public certificate installation was used. Automatic worktree/task binding, shared editing, merge queues, connector account OAuth, invitation expiry/key rotation, server backup/restore and scalable multi-instance coordination remain outstanding. See the feature status table before treating a planned feature as delivered.
