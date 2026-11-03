# Tool approval

Agents ask before they run a command, edit a file or fetch a page. Tributary shows the request in the running turn and the person answers: **Allow once**, **Always allow** or **Deny**. These shared controls now cover ACP agents and the local native Claude and Codex adapters.

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

## Claude Code — implemented

The built-in local Claude adapter now uses stream-json input and the stdio host permission channel. The runner keeps stdin open, returns Allow/Deny answers, cancels withdrawn requests and sends an interrupt before a bounded process shutdown. Native questions use answer forms rather than a generic permission grant. Current Task tools and legacy TodoWrite update the plan display. No global permission settings are changed.

The installed Claude 2.1.292 accepts `--permission-prompt-tool stdio`. Protocol behavior has fixture coverage; authenticated Claude model execution was not exercised in this pass. SSH keeps its existing stream launcher. Claude ACP remains an alternative through Browse agents.

## Codex — implemented

The built-in local adapter uses Codex app-server over private stdio, preserving real Codex thread IDs and streaming text/tool events. Command, file-change and additional-access requests use the same approval cards as Claude and ACP. Native user-input requests use the same question forms. Read-only declines file changes and additional write grants. Unsupported protocol requests fail closed. Session allowances do not write persistent exec/network policy amendments.

The installed CLI generated the schemas used by the adapter. Default, Ollama and LM Studio configurations completed isolated initialize handshakes without model prompts. Tool execution is verified with protocol fixtures, not paid provider inference. SSH retains the existing exec stream path.

## Other coding agents

Gemini uses its native ACP mode locally, including model selection and negotiated image support. OpenCode, Goose, Qwen and other ACP agents retain pooled sessions and the common tool/plan/approval controls. When ACP cannot reload a session, the next native session receives compact conversation context instead of losing prior work. Stream-only agents retain their own CLI permission mode and do not show unsupported interactive capabilities.

See [Native agent behavior](NATIVE_AGENT_BEHAVIOR.md) for the capability table, background-work limits and verification boundaries.
