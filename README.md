# Tributary

Every coding agent, one stream of work.

Tributary is a desktop app (and VS Code extension) that runs the coding agents already on your computer from one place: Claude Code, Codex, Gemini CLI, Google Antigravity, and any agent that speaks the Agent Client Protocol (OpenCode, Goose, Qwen Code, Kimi and more). Every agent works in the same project folder. When you switch agents mid-conversation, the next one gets a summary of the thread and the git working tree, so nobody starts from zero.

It drives each agent through its own official headless or protocol mode, so your sign-ins, subscriptions, settings and session history stay with each agent.

## What it does

- **One conversation, any agent.** Pick Claude Code for one turn and Codex for the next. Handoff, resume and catch-up are automatic.
- **Teams.**
  - **Race:** several agents attempt the same task, each in its own git worktree and branch. Your test command runs in each, you compare the diffs, and you apply one. Your files are untouched until then, and a conflict is reported instead of written into your files.
  - **Plan, build, review:** one agent plans, another builds, a third reviews until it approves. Build and review, and Ask everyone, follow the same pattern.
- **Safety.** A git checkpoint is taken before every turn and can be restored. Permission modes are Read-only, Edit files and Full auto. Plan mode plans first and runs after you approve.
- **Workspace panel:** Review (uncommitted changes and commit), Changes (exactly what each turn changed), Files (a CodeMirror code editor with previews for Markdown, images and HTML), Memory, and Preview (your local dev server).
- **Terminal:** xterm.js with GPU rendering on real pseudo-terminals (node-pty).
- **Shared memory:** `.tributary/memory.md` holds project facts, and `.tributary/worklog.md` logs who did what. AGENTS.md points every agent to both. "Remember this" on any reply adds a note.
- **Model gateways:** point agents at LiteLLM, Ollama, LM Studio, DeepSeek, OpenRouter or any OpenAI, Anthropic or Gemini compatible endpoint. Keys are encrypted with the system keychain.
- **MCP and skills:** see every agent's MCP servers side by side and add one to several agents at once through each agent's own `mcp add` command. Skills are merged across agents and can be shared with all of them. Project `.mcp.json` servers are passed into ACP sessions.
- **Tasks and documents:** guided tasks for non-coding work (summarize, compare, write, translate, study) and saved documents you can export.
- **Also:** `@` file mentions, `/` commands and skills, a command palette (Ctrl+K), notifications, message queueing, retry, export to Markdown, extra project folders, and opening a file in VS Code, Cursor or Windsurf.

## Requirements

- Linux, macOS or Windows with Node.js 20 or newer and git.
- At least one coding agent installed and signed in. The setup screen finds them and has a **Sign in** button for each one.

| Agent | How Tributary runs it |
|---|---|
| Claude Code | `claude -p` with stream-json output |
| Codex | `codex exec --json` |
| Gemini CLI | `gemini -p` with stream-json output. Personal Google sign-in was retired, so use a Gemini API key gateway. |
| Antigravity | `agy -p` with stream-json output |
| ACP agents (OpenCode, Goose, Qwen Code, Kimi, registry agents) | Agent Client Protocol over stdio, one process per agent and folder |
| Anything else | Add it to `agents.json` (Settings, Agents, Add a custom agent) |

## Run it

```bash
npm install
npm --prefix ui install
npm start
```

`npm start` builds the UI and opens the desktop app. Pass a folder to open it as a project:

```bash
npm run dev -- /path/to/project
```

## VS Code extension

```bash
npm run vscode:install
```

Then reload VS Code. Tributary appears in the activity bar. Workspace folders become projects, diffs open in VS Code's diff editor, and terminals use VS Code's own terminal. **Ask an Agent About Selection** (Ctrl+Alt+I) sends the selected code to the composer.

## Command line

The `tributary` command runs the same hub from a terminal. Install it from this folder:

```bash
npm link
```

Run it inside a project. Each `ask` continues the latest thread in that folder, so a second agent picks up where the first stopped:

```bash
tributary ask -a claude "add input validation to the signup form"
tributary ask -a codex "review what claude just changed"
```

Race two agents on the same task. Each works in its own git worktree, your test command decides, and your files stay unchanged until you apply one:

```bash
tributary race -a claude,codex --test "npm test" "fix the failing date parser test"
tributary apply codex
```

| Command | What it does |
|---|---|
| `ask [-a agent] "request"` | One turn in this folder. `-m read\|edit\|full` sets the permission mode, `--plan` plans without changing anything, `--new` starts a new thread, and `-` reads the request from stdin |
| `race -a a,b [--test cmd] "task"` and `apply <agent>` | Race agents in separate worktrees, then apply one result |
| `agents` | Installed agents and their versions |
| `threads`, `show`, `export -o file` | List, print or save threads |
| `diff`, `undo` | What the last turn changed, and restoring files to before it |
| `memory`, `memory enable`, `memory remember "note"` | Shared project memory in `.tributary/memory.md` |
| `mcp`, `skills`, `registry [add\|remove <id>]`, `doctor` | MCP servers, skills, ACP registry agents, and a setup check |

Every command accepts `--json`, `-C <dir>` and `--no-color`. Ctrl+C stops the running agent and keeps what it wrote so far.

The CLI keeps its threads in `~/.config/Tributary/cli` (or `--data-dir`, or `TRIBUTARY_DATA_DIR`), apart from the desktop app, because both rewrite their thread file. Gateway keys are stored in a `secrets.json` file there that only your user can read, since a terminal has no keychain bridge.

## Tests

```bash
npm test
```

The suite covers the stream parsers (with recorded output from the real agents), handoff, gateways, the process runner, the ACP client and pool, teams, race mode in worktrees, checkpoints, memory, MCP, skills, the registry client, the terminal manager, editor detection, the command line, and the VS Code extension (against a stand-in `vscode` module). Two scripts run real agents and use a little of your quota:

```bash
npm run test:e2e
```

```bash
node test/e2e/real-race.js /tmp/tributary-data /tmp/tributary-race claude codex
```

## Layout

| Folder | What is in it |
|---|---|
| `core/` | Agent registry and detection, stream parsers, runner, ACP client, handoff, hub, git checkpoints, race, teams, memory, MCP, skills, gateways, registry, terminal, editors |
| `desktop/` | Electron main process and the preload bridge |
| `cli/` | The `tributary` command line |
| `ui/` | React, Tailwind and shadcn/ui interface, shared by the desktop app and the extension |
| `vscode/` | VS Code extension: webview host, bridge and build script |
| `test/` | node:test suites, fake agents and recorded fixtures |
| `docs/` | Research notes, improvement plan and performance work |

## Security notes

- Agents run with your user's permissions. Read-only and Edit modes map to each agent's own permission settings; Full auto approves everything, so use it only in projects you trust.
- API keys for gateways are stored encrypted with the OS keychain when available, never in `hub.json`.
- MCP listings mask keys, tokens and header values.
- The window runs with context isolation and sandboxing, and the page can only call an allowlisted set of methods.

## Research

- [docs/MULTI_AGENT_LANDSCAPE.md](docs/MULTI_AGENT_LANDSCAPE.md): competing apps, what makes multi-agent coordination work, and patterns read from open-source apps' source.
- [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) and [docs/PERFORMANCE_ARCHITECTURE.md](docs/PERFORMANCE_ARCHITECTURE.md): product and performance plans.
