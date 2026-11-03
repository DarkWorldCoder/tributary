# Native agent behavior

Updated 3 November 2026. Implemented locally; adapters use the installed coding agent and its own account, tools, project rules and session history.

| Agent | Transport | Live tools / plans | Approvals | Questions | Continuation |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Stream JSON + stdio control | Tool input streams, Task tools, TodoWrite and native task events | Allow once, session allowance, deny | Native AskUserQuestion forms | Claude session ID |
| Codex | Native app-server over stdio | Text deltas, commands, file changes, MCP, plans, collaboration events | Commands, file changes, additional access | Native request-user-input forms | Codex thread ID |
| Gemini CLI | Native ACP | Tool calls, outputs, plan entries | ACP requests | Standard ACP has no shared question-form request | ACP session; compact fallback when reload is unavailable |
| OpenCode, Goose, Qwen and other ACP agents | Their ACP implementation | Events the agent provides | ACP requests | Depends on agent extensions | ACP reload when supported; compact fallback otherwise |
| Antigravity and stream-only custom agents | Existing native stream | Reported tools and output | Their CLI mode; no invented approval prompt | No shared form channel | Existing session handling |
| Direct model connections | Provider text/image API | Text/image conversation | No coding-tool execution | Normal conversation | Tributary transcript |

Settings → Agents → Details shows the actual adapter capabilities. Native local controls do not replace the remote SSH stream path. Recent native CLI versions are required; the installed Claude 2.1.292 flag accepts stdio permissions, and the installed Codex app-server supplied the schemas used here.

## Shared controls

- Pending actions use the same in-chat approval card and sidebar status. Without an approval-capable host, unresolved requests are declined.
- Questions require actual selections or text. Generic Allow and Always cannot answer a question. Stop and withdrawn requests cancel their pending forms.
- Read-only declines native file-edit requests and additional write-access grants. Starting implementation from a plan remains an explicit new turn with its selected permission mode.
- Session allowances live in Tributary memory, scoped to the agent session and exact command/access request. No global permission files or persistent exec/network policy amendments are written.
- Native modes may approve actions before the host callback. Full auto retains its existing broad permissions; approval cards show requests that reach the host.
- Codex receives local image attachments; ACP receives inline images only when the agent advertises image support. Existing attached-file references remain available to coding tools.
- Existing agent MCP servers and skills stay with the agent. Direct model endpoints do not gain a tool runtime by being connected.

## Background work

Use **Start agent team**, **/team**, or ask a coding agent to delegate independent pieces. Choose 1, 2 or 4 workers and a default worker provider in Settings → Agents. Each delegated task can explicitly choose a compatible configured provider. Tributary's workers run in separate chats and Git copies; see [Agent delegation](AGENT_DELEGATION.md). Native subagent events appear in the tool trace when the CLI emits them. A native task event is not presented as a new Tributary chat or as proof that the task survives its parent CLI process.

Claude's experimental interactive agent teams do not start teammates in noninteractive `-p` runs. Tributary therefore supplies its own scoped delegation bridge; it does not silently enable native experimental teams. [Claude agent teams](https://code.claude.com/docs/en/agent-teams).

## Context efficiency

The handoff formatter visits the original goal and a bounded recent tail instead of formatting every old message. Project memory removes duplicate excerpts, keeps source line references and reports exact character usage. Compact / Balanced / Detailed limits are 2,000 / 4,000 / 8,000 characters. Sharing remains opt-in. These are deterministic context limits, not claims of semantic compression or measured token savings.

## Verification boundaries

Protocol fixtures cover live streams, current Task tools, approvals, denial, question answers, cancellation, session continuation, Gemini model selection, ACP images and fallback context. Installed Codex default/Ollama/LM Studio configurations completed an initialize handshake in isolated homes without any model prompt. No paid inference, real-provider tool action, second computer, or native Mac/Windows runtime was used for these checks.

Primary references: [Claude user input](https://code.claude.com/docs/en/agent-sdk/user-input), [Claude task tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking), [Claude SDK types](https://code.claude.com/docs/en/agent-sdk/typescript), [Codex source](https://github.com/openai/codex), [ACP protocol](https://agentclientprotocol.com/protocol/overview).
