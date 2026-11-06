# Local models

Open **Settings → Connections → Set up local models**.

1. Choose **Unsloth**, **Ollama**, **LM Studio** or **llama.cpp**. Detection checks only local API addresses.
2. Open that model app and load a chat model, or use the desktop app-managed llama.cpp controls below.
3. For Unsloth, create a key in **Settings → API**. Paste it into Tributary and select **Refresh models**.
4. Choose the model and a history budget. For coding, turn on **Local coding agent**, then choose **Start local agent**. Otherwise choose **Start local chat**.

The connection becomes an assistant in the model picker. Existing chats, including chats from other providers, stay available. **Test connection** sends a short generation request; detection and Refresh models only read metadata.

| Service | Default API address |
| --- | --- |
| Unsloth | `http://127.0.0.1:8888/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp | `http://127.0.0.1:8080/v1` |

Use the address actually shown by the model app. Unsloth can use another port, including 8000; edit its address and refresh. Private keys use Tributary’s existing credential storage. Detection never broadcasts a saved key to the other services. Remote endpoints belong in **Add connection**, with HTTPS.

## Start a CPU model from the desktop app

Choose **llama.cpp**, then select an existing **llama-server executable** and **GGUF model file**. Choose context, CPU threads and an idle-release interval, then **Start engine**. The model loads explicitly; Tributary does not download or install its runtime or weights. Choose **Start local chat** or **Start local agent** after it is ready.

Idle release unloads the model and context. A new chat request reloads them automatically; checking status or refreshing its model list leaves it asleep. **Stop engine** releases the owned process; **Cancel startup** handles a slow or stuck start. Stop active chats before stopping the engine. Quit also stops the owned runtime. Other model apps/services are untouched.

The address and private credential are managed automatically. The saved connection is reused on restart. This CPU engine runs one generation at a time to bound context memory; additional chats/agents queue. Existing external services keep their chosen parallel-request limits. Native versions must support llama.cpp's idle-sleep option. See [measured scope and results](performance/LOCAL_ENGINE.md).

## Memory use

Model weights and inference stay in a native process: your external service, or the explicitly started app-managed CPU engine. Tributary does not bundle another runtime. Choose a model/quantization that fits your RAM and GPU memory in the external service; displayed system RAM is not a GPU compatibility check. The app-managed engine is CPU-only.

Local chats default to **Compact**: up to 4,000 characters of previous chat and 2,000 characters of project-memory excerpts, when project memory sharing is enabled. Balanced and Extended budgets are available. The current request, attachments and formatting overhead are additional; these character budgets are not exact token limits or VRAM estimates. Saved history and original memory notes are preserved. Unload external models using their model app; use idle release or Stop engine for the managed CPU model. Sleeping releases model/context allocations, while some native runtime memory remains.

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
