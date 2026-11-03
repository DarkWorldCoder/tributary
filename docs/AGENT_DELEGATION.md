# Agent delegation

## From chat

Ask a local coding agent to split a task among background agents. For example: **“Have two agents build the interface and service in separate background chats.”** The agent can list available workers, start chats, check their results and stop them through Tributary's turn-scoped delegation command. Its normal shell approval rules still apply.

**Worker model source** chooses the chat’s provider, the agent’s own account, or a configured compatible gateway. It applies to new workers. The scoped command supports `sources` and per-worker `--source SOURCE_ID` / `--model MODEL_ID`; incompatible sources are rejected rather than silently switching providers. Running workers retain their original provider. Gateway secrets are never listed.

Worker cards appear in the parent reply. Open one to follow progress, review changes and merge its copy. **Parent chat** returns to the requesting conversation. Workers can keep running after the parent finishes replying. **Stop** on the parent also cancels its active workers. Agents can inspect their existing workers in later turns.

Choose one, two or four simultaneous workers in **Settings → Agents → Background subagents**. The default is two; the limit is four new worker chats per parent turn. Workers cannot spawn more workers. Delegation is unavailable in read-only, everyday-task, untrusted-project or non-Git chats. Disable **Tools → Agent delegation** to turn off the command. It uses an authenticated loopback bridge with credentials held only in the turn's environment; it does not edit global agent/MCP settings or expose the room server.

## Choose a team yourself

1. Open **Agent teams → Manager**.
2. Choose the **Lead agent** and coding **Workers**.
3. Set **Workers at once** and optional **Checks**.
4. Choose **New background chat → Start in background**.
5. Follow tasks in **Live activity**. Open the background chat to review and merge its working copy.

The lead assigns each subtask to a selected worker. Legacy plans without assignments use round-robin assignment. Unknown worker IDs are rejected. Workers run independently in Git working copies, with at most one task per selected agent and a bounded concurrency limit. Dependencies wait until their predecessors merge; workers receive those predecessors' results and changed-file lists. Failed attempts receive feedback and retry once. Failed dependency chains are skipped.

Background coding teams require a Git repository with at least one commit. They get a separate conversation working copy from the project's current commit; uncommitted edits are not copied. Their workers integrate there; your active project is left for an explicit review/merge. Multiple background teams can run in different copies. Read-only **Ask everyone** runs do not need a separate copy. Coding delegation requires Edit files or Full auto; it cannot elevate a read-only request.

Stop cancels active workers and their test processes, skips queued work, and preserves changes already integrated before stopping. Configured checks gate worker and integration results; without a test command, checks are shown as skipped. Task assignments, results, files, branches and completion states are saved in the chat. A completed Manager run is recorded as done, partial work needs attention, and stopped/failed runs keep their actual status. Background chat titles use your task, not the lead's internal instructions.

Type **`/team your task`** in the message box to prepare this setup directly.

Background means you can keep working while Tributary stays open. It does not install an always-on daemon or execute agents on teammates' computers. Work interrupted by quitting the app is not automatically resumed. Installed coding agents with shell access can use the chat delegation command; direct text connections do not gain coding tools.

## Validation

Automated tests cover lead assignment, concurrency limits, dependency handoff, parent/worker isolation, chat-scoped credentials, credential revocation, permission limits and cancellation. An isolated Electron session ran two Manager teams concurrently with fake local coding agents. Each lead assigned selected workers, dependency results reached the next worker, both teams integrated into separate conversation copies, and the active project stayed unchanged. No paid model calls were made. See [delegation checks](performance/AGENT_DELEGATION.json).
