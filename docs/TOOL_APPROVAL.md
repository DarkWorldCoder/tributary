# Tool approval

Agents ask before they run a command, edit a file or fetch a page. Tributary shows the request in the running turn and the person answers: **Allow once**, **Always allow** or **Deny**. This page covers how that works for ACP agents today. It also covers how Claude Code and Codex would plug into the same model, and what `core/runner.js` needs for that.

Checked on 2026-11-03 against Claude Code 2.1.292 (the installed binary, plus the docs at code.claude.com), the Codex app-server docs, and the ACP registry.

## What happens today (ACP agents)

`core/acp.js` gets `session/request_permission` from the agent. The thread's permission mode decides the easy cases. Everything else goes to the person.

| Mode | Edits (`kind: edit`) | Commands, fetches, anything else |
| :- | :- | :- |
| Read-only | Declined, without asking | Asked |
| Edit files | Allowed, without asking | Asked |
| Full auto | Allowed | Allowed |

Read-only never asks about edits, because it promises not to change files. `fs/write_text_file` is refused in that mode anyway.

### The pending request

A request the mode doesn't settle becomes a pending request on the turn. The hub stores it as `message.permissions[]`, so it survives a reload of the window:

```js
{
  id, threadId, messageId, agent, sessionId, toolCallId,
  title: 'Run npm test',          // the agent's own title for the tool call
  kind: 'execute',                // ACP tool kind: read, edit, delete, move, search, execute, fetch, other
  command: 'npm test',            // when the tool runs a command
  path: '/abs/path',              // when it targets a file
  options: [{ optionId, name, kind }], // the agent's options: allow_once, allow_always, reject_once, reject_always
  status: 'pending',              // then allowed, always, rejected or cancelled
  ts, answeredAt,
}
```

The request often names only the `toolCallId`. The client fills in the title, kind and input from the agent's earlier `tool_call` updates.

### Hub API

These are on the desktop and VS Code allowlists. `test/vscode.test.js` checks that both expose them.

- `permissions(threadId?)`: the requests waiting for an answer, for one thread or for all of them.
- `answerPermission(id, choice)`: `choice` is `'once'`, `'always'`, `'reject'`, or one of the request's own `optionId`s. Answering a request that is no longer waiting throws.

The hub emits `permission` with `{ threadId, request }` when a request starts waiting and again when it is answered. It also emits `message` and `threads` on both occasions. While a request waits:
- The thread's status is `permission` (`core/status.js`), and the sidebar shows **Approve**.
- A `permission` notification is sent. The desktop shows it as a system notification when the window is in the background. VS Code shows a warning with **Open**.

### Answers

| Person picks | Option sent to the agent | Also |
| :- | :- | :- |
| Allow once | `allow_once` (or any `allow*`) | |
| Always allow | `allow_always`, else `allow_once` | The hub remembers it for the rest of the agent session. For edits that covers every edit; for anything else, the same kind with the same command (or title). |
| Deny | `reject_once` (or any `reject*`); `cancelled` if the agent offers none | A `Denied: <title>` notice on the turn |
| Stop the turn | outcome `cancelled`, as ACP requires for a cancelled prompt turn | |

A request is also cancelled when its turn ends or the agent exits.

### Who can answer

`new Hub({ approvals: true })` says the host can show requests. The desktop app and the VS Code extension set it. The CLI and the race runner don't, so requests there are declined as before, with a `Declined: … (mode: …)` notice.

The hand-off between the protocol code and the hub is a plain event, so other protocols can use it too:

1. The protocol emits `{ kind: 'permission', request }` through the turn's `onEvent`.
2. If someone will ask the person, they set `event.answer` to a promise during that same synchronous call. The promise resolves to `'once' | 'always' | 'reject' | optionId | null` (null means cancelled).
3. If `event.answer` is still unset when `onEvent` returns, nobody is listening, and the protocol falls back to its automatic answer.

`core/runner.js` passes events through unchanged, so this already works for ACP without touching the runner.

## Claude Code

Tributary runs `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode <plan|acceptEdits|bypassPermissions>` and writes the prompt to stdin. In `-p` mode nobody can answer a prompt, so anything the mode doesn't allow is denied.

### Option A, works today: Claude through ACP

The ACP registry lists `claude-acp`, which runs `npx @agentclientprotocol/claude-agent-acp`. Installing it from **Browse agents** gives Claude with interactive approval through the code above. It is the same adapter Zed uses.

### Option B, recommended for the built-in agent: the stdio control protocol

This is the protocol the Agent SDK's `canUseTool` uses. The SDK starts the CLI with `--permission-prompt-tool stdio`, and permission prompts then travel over stdin and stdout as JSON lines next to the normal stream-json messages. The shapes below are taken from the 2.1.292 binary. They are not in the public docs, so check them against the installed version.

Start the CLI with:

```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages \
  --permission-mode <plan|acceptEdits|bypassPermissions> --permission-prompt-tool stdio
```

**The prompt.** Send it as a stream-json user message, and keep stdin open until the `result` message arrives:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
```

**The request**, from CLI to Tributary, on stdout:

```json
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
 "input":{"command":"npm test","description":"…"},"tool_use_id":"toolu_…","description":"…",
 "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test"}],"behavior":"allow","destination":"session"}],
 "blocked_path":"…","decision_reason":"…"}}
```

**The answer**, from Tributary to CLI, on stdin:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"allow","updatedInput":{…}}}}
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"deny","message":"The user denied this."}}}
```

**Withdrawn and stopped requests.**
- The CLI may send `{"type":"control_cancel_request","request_id":"…"}` when it no longer needs an answer.
- To stop the turn, Tributary sends `{"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}}`. This stops the turn but keeps the session usable for `--resume`.

Mapping to the pending request:

| Pending request | From `can_use_tool` |
| :- | :- |
| `title` | `description` or `display_name` plus the command or file |
| `kind` | `execute` for Bash; `edit` for Edit, Write, MultiEdit and NotebookEdit; `fetch` for WebFetch; `read` for Read |
| `command` | `input.command` |
| `path` | `input.file_path`, or `blocked_path` |
| `options` | Made up by Tributary: `allow_once`, plus `allow_always` when `permission_suggestions` is not empty, plus `reject_once` |

| Answer | `control_response.response` |
| :- | :- |
| once | `{ behavior: 'allow', updatedInput: input }` |
| always | the same, plus `updatedPermissions`: the `permission_suggestions` whose `destination` is `session` |
| reject | `{ behavior: 'deny', message: 'The user denied this.' }` |
| cancelled (stop) | `{ behavior: 'deny', message: 'Stopped by the user.', interrupt: true }`, then the `interrupt` request |

With the modes unchanged, Claude asks in the same cases as an ACP agent:
- In `acceptEdits`, edits run without asking and Bash commands ask.
- In `plan`, edits come to the callback. Tributary should decline them without asking, to keep Read-only's promise.
- `bypassPermissions` asks only about the few actions no mode approves, such as critical-path `rm`.

`AskUserQuestion` also arrives as `can_use_tool`. Decline it until there's UI for questions.

### Option C: an MCP permission prompt tool

`--permission-prompt-tool mcp__<server>__<tool>` is the documented route. Tributary would run a small MCP server that the CLI calls for each prompt. The tool returns `{"behavior":"allow","updatedInput":…}` or `{"behavior":"deny","message":…}` as JSON text.

This needs an MCP server process and `--mcp-config` for every run, and the CLI waits for that server to start before the first turn. Option B gives the same answers with fewer moving parts.

### Runner changes needed for Claude (`core/runner.js` and `core/parsers.js`)

1. Add `--input-format stream-json --permission-prompt-tool stdio` to the `claude` args in `core/agents.js`. If no host can answer, the runner falls back to denying, which is today's behavior.
2. Write the prompt as one stream-json user message instead of raw text. Keep stdin open (the `keepOpen` option of `proc.start`, as ACP does), and end it after the `result` message.
3. Have the `claude-stream` parser turn `control_request` / `can_use_tool` into `{ kind: 'permission', request, requestId }`. Have it turn `control_cancel_request` into `{ kind: 'permission-withdrawn', requestId }`.
4. In the runner, for a `permission` event:
   - Await `event.answer`. If nobody set it, answer at once: allow edits in Edit files mode, and deny everything else.
   - Write the matching `control_response` to the child's stdin.
5. For a `permission-withdrawn` event, call `event.withdraw?.()` on the original event. The hub would set `withdraw` next to `answer`; that is a small hub change to make together with this step.
6. On stop, send the `interrupt` control request first. Kill the process only if it is still running a few seconds later. Pending requests are already answered as cancelled by the hub.
7. Tests: extend `test/fake-agent.js` with a `claude-stream` mode that sends a `can_use_tool` request and prints the answer it gets. Reuse the cases in `test/permissions.test.js`.

## Codex

Tributary runs `codex exec --json …` with `-s read-only`, `-s workspace-write`, or `--dangerously-bypass-approvals-and-sandbox`. `codex exec` is non-interactive and never asks for approval, so there is nothing to answer today.

### Option A, works today: Codex through ACP

The ACP registry lists `codex-acp`, which runs `npx @agentclientprotocol/codex-acp`. It maps Codex approvals to `session/request_permission`.

### Option B, recommended for the built-in agent: `codex app-server`

`codex app-server` is the protocol the Codex IDE extension uses.
- **Transport:** JSON-RPC 2.0 over stdio, one JSON message per line, with the `"jsonrpc":"2.0"` field left out on the wire.
- **Schema:** `codex app-server generate-json-schema --out DIR` writes the exact schema for the installed version.

**Setup.**
1. Send `initialize` with `{ clientInfo: { name: 'tributary', title: 'Tributary', version } }`, then the `initialized` notification.
2. Call `thread/start` for a new thread, or `thread/resume` with the stored thread id. Its params include `approvalPolicy` and `sandbox`.

**A turn.**
- `turn/start` takes `{ threadId, input: [{ type: 'text', text }], approvalPolicy, sandboxPolicy }`.
- Progress arrives as `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed` and `turn/completed`.
- `turn/interrupt` with `{ threadId, turnId }` stops the turn. It then ends with status `interrupted`.

**Approval requests**, from server to client:
- `item/commandExecution/requestApproval` with `{ threadId, turnId, itemId, reason?, command?, cwd?, commandActions?, proposedExecpolicyAmendment?, availableDecisions? }`.
  - Decisions: `accept`, `acceptForSession`, `decline`, `cancel`, or `{ acceptWithExecpolicyAmendment: { execpolicy_amendment: [...] } }`.
- `item/fileChange/requestApproval` with `{ threadId, turnId, itemId, reason?, grantRoot? }`.
  - Decisions: `accept`, `acceptForSession`, `decline`, `cancel`.
  - The files are in the `fileChange` item from the `item/started` that came just before.
- After the answer, or when the server clears the request, the server sends `serverRequest/resolved`.

Mapping:

| Tributary | Codex |
| :- | :- |
| Read-only | `sandbox: read-only`, `approvalPolicy: on-request` |
| Edit files | `sandbox: workspace-write`, `approvalPolicy: on-request` |
| Full auto | `sandbox: danger-full-access`, `approvalPolicy: never` |
| No host can answer | `approvalPolicy: never`, as `codex exec` does today |
| `kind`, `command`, `path` | `execute` with `command`; `edit` with the `fileChange` item's paths |
| once / always / reject / cancelled | `accept` / `acceptForSession` / `decline` / `cancel` |
| Request withdrawn | `serverRequest/resolved` for a request that is still pending |

Codex's own `acceptForSession` covers "always". The hub's memory is only a backup.

Other server requests can be declined until there's UI for them:
- `item/permissions/requestApproval` (extra network or filesystem access)
- `tool/requestUserInput`
- `mcpServer/elicitation/request`

### Runner changes needed for Codex (`core/runner.js`, new `core/codex-app.js`)

1. Add a `codex-app` protocol: a long-lived JSON-RPC client shaped like `AcpConnection` in `core/acp.js`.
   - Pool one process per folder and environment.
   - Do the handshake: `initialize` and `initialized`.
   - Call `thread/start` or `thread/resume`, then `turn/start`.
   - Turn notifications into normalized events: agent message deltas become `text`, reasoning becomes `thinking`, `commandExecution` becomes `tool`, `fileChange` becomes `tool` plus `file`, `turn/completed` becomes `done`, and token usage becomes `usage`.
2. In `runTurn`, send `agent.protocol === 'codex-app'` to it, the same way `acp` goes to `runAcp`.
3. Answer `item/*/requestApproval` through the same `{ kind: 'permission' }` event and `event.answer`. If nobody answers, decline, which matches today.
4. Use `serverRequest/resolved` for a request that is still pending to withdraw it (see step 5 of the Claude list).
5. On stop, send `turn/interrupt`. Answer pending requests with `cancel`; the hub already does this through the abort signal.
6. In `core/agents.js`, make `codex-app` the Codex protocol when `codex app-server` is available. Keep `codex-exec` as the fallback for older installs and for the CLI.
7. Tests: a `test/fake-codex-app.js` that speaks the app-server protocol and asks for one command approval and one file-change approval.

## Not covered yet

- Gemini CLI and Antigravity. Gemini CLI has an ACP mode (`gemini --acp`, the hidden `gemini-acp` agent), so it can use the ACP path. Antigravity's protocol was not checked.
- Editing the input before allowing it. Claude supports this with `updatedInput`, and Codex with an exec-policy amendment.
- Remembering answers across sessions, for example writing Claude's `localSettings` suggestions.
