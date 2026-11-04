# Local models

Open **Settings → Connections → Set up local models**.

1. Choose **Unsloth**, **Ollama** or **LM Studio**. Tributary checks only their local API addresses.
2. Install/open that model app if necessary, then download and load a chat model there.
3. For Unsloth, create a key in **Settings → API**. Paste it into Tributary and select **Refresh models**.
4. Choose the model and a history budget. For coding, turn on **Local coding agent**, then choose **Start local agent**. Otherwise choose **Start local chat**.

The connection becomes an assistant in the model picker. Existing chats, including chats from other providers, stay available. **Test connection** sends a short generation request; initial detection and setup only list models.

| Service | Default API address |
| --- | --- |
| Unsloth | `http://127.0.0.1:8888/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |

Use the address actually shown by the model app. Unsloth can use another port, including 8000; edit its address and refresh. Private keys use Tributary’s existing credential storage. Detection never broadcasts a saved key to the other services. Remote endpoints belong in **Add connection**, with HTTPS.

## Memory use

Model weights and inference stay in the external model service. Tributary does not bundle or load another model runtime. Choose a model/quantization that fits your RAM and GPU memory in that service; displayed system RAM is not a GPU compatibility check.

Local chats default to **Compact**: up to 4,000 characters of previous chat and 2,000 characters of project-memory excerpts, when project memory sharing is enabled. Balanced and Extended budgets are available. The current request, attachments and formatting overhead are additional; these character budgets are not exact token limits or VRAM estimates. Saved history and original memory notes are preserved. Unload models using the model app when you need to free its RAM/VRAM.

## Local coding agents

Open a project folder and enable **Local coding agent** during setup or while editing its connection. A function-calling model can list/search/read files, write or edit files, run commands, and coordinate background workers. Tributary executes these tools locally; Unsloth's own server-side tools remain disabled.

- **Read-only / Plan:** file inspection only; no writes or commands.
- **Edit files:** file writes and commands use the existing approval cards. With no approval UI, these actions are denied.
- **Full access:** actions can run without approval in a trusted project. Shell commands run on the computer without an OS sandbox and can access outside the project. File tools enforce project boundaries and reject stale writes.
- **Background work:** chats continue when you switch views. Use separate working copies for concurrent writes to the same project. Start background worker chats with the structured background-agent tool or use Agent teams. Each worker has its own connection and working copy; stopping the parent stops its active workers. Closing Tributary stops work; this is not a system daemon.

Local coding agents appear in the normal assistant, team and worker selectors. A model must support OpenAI-compatible structured tool calls; not every listed model does. Unsupported calls and incomplete streams fail without running that batch. There is no silent fallback to a different provider. The agent performs up to 24 model steps / 64 tool calls per turn; tool results and prior tool groups are bounded. Send a follow-up to continue. No web-search tools are bundled with this local mode, so Deep research remains available on other compatible agents.

File writes update the real project and the editor's existing file watcher; changes and line counts appear through the same checkpoint/review path as native coding agents. Background copies require explicit review/merge.

## Resume after a disconnect

A failed network request shows **Connection interrupted → Resume**. Reconnect or restart the local model server, then choose Resume. Completed file changes stay on disk.

DNS failures, offline errors, timeouts and lost/refused connections use this same recovery path. If the connection fails again while resuming, use Resume on the latest interrupted reply. You can reopen Tributary before continuing; reconnecting does not run tasks automatically.

For local coding agents, a private checkpoint retains completed tool calls and results; it survives reopening Tributary and does not automatically re-run those calls. Checkpoints are limited to 2 MB, replaced by the next interrupted turn, and removed after success or chat deletion. Changing the model, server or working folder invalidates the checkpoint. Provider credentials are excluded. A manually stopped turn is not treated as a network failure.

Native coding agents continue their recorded provider session when supported; otherwise they receive the saved chat context and instructions to inspect current files. A command whose result was interrupted may still need inspection. Recovery is explicit; reconnecting alone does not start commands automatically.

## Sources

Implemented against Unsloth’s documented [`/v1/models` and streaming `/v1/chat/completions` APIs](https://unsloth.ai/docs/basics/api), including explicit disabling of its server-side tools for direct chat. Tool calling follows [LM Studio’s function API](https://lmstudio.ai/docs/developer/openai-compat/tools) and [Ollama’s tool protocol](https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx). No Unsloth runtime/source is bundled. See also [Ollama compatibility](https://docs.ollama.com/openai) and [LM Studio compatibility](https://lmstudio.ai/docs/developer/openai-compat).
