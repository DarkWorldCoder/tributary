# Tributary

Every coding agent, one stream of work.

Tributary is a desktop app (and VS Code extension) that runs the coding agents already on your computer from one place: Claude Code, Codex, Gemini CLI, Google Antigravity, and any agent that speaks the Agent Client Protocol (OpenCode, Goose, Qwen Code, Kimi and more). Every agent works in the same project folder. When you switch agents mid-conversation, the next one gets a summary of the thread and the git working tree, so nobody starts from zero.

It drives each agent through its own official headless or protocol mode, so your sign-ins, subscriptions, settings and session history stay with each agent.

## What it does

- **One conversation, any agent.** Pick Claude Code for one turn and Codex for the next. Handoff, resume and catch-up are automatic.
- **Teams.**
  - **Race:** several agents attempt the same task, each in its own git worktree and branch. Your test command runs in each, you compare the diffs, and you apply one. Your files are untouched until then, and a conflict is reported instead of written into your files. **Pick the best with…** then asks an agent to compare every candidate's diff and test result and recommend one.
  - **Manager:** one agent splits the task into a small graph of independent pieces. Workers build them at the same time, each in its own git worktree. A piece is merged into your files only if it applies cleanly and your test command passes after the merge; otherwise it is rolled back and tried once more with the failure as feedback. Pieces that depend on another wait until it is merged.
  - **Plan, build, review:** one agent plans, another builds, a third reviews until it approves. Build and review, and Ask everyone, follow the same pattern.
- **Separate working copies.** Turn on **Separate copy** in a conversation's header and it gets its own git worktree and branch (`tributary/thread-<id>`), made from the project's last commit and kept in Tributary's data folder. Its turns, checkpoints, diffs and files use that copy, so several conversations can change the same repository at once. The branch shows on the conversation's sidebar row. **Merge** commits the copy's work and merges it into the project's current branch; it is refused, with the files named, if they conflict with changes made there or with uncommitted changes in your folder, and the work stays on the branch. **Discard** deletes the copy and its branch. Deleting a conversation removes its copy but keeps the branch, with any unfinished work committed to it.
- **Safety.** A git checkpoint is taken before every turn and can be restored. Permission modes are Read-only, Edit files and Full auto. Plan mode plans first and runs after you approve.
- **Live activity:** while agents work, a pill shows how many are running. It opens a view of every agent across conversations, teams, races and managed runs: what each one is doing now, the files it changed, and each file's diff as it changes.
- **Thread status:** the sidebar marks each thread as working, needs review (it finished with file changes you have not opened yet), failed, or done.
- **Workspace panel:** Review (uncommitted changes and commit), Changes (exactly what each turn changed), Files (a CodeMirror code editor with previews for Markdown, images and HTML), Memory, and Preview (your local dev server).
- **Terminal:** xterm.js with GPU rendering on real pseudo-terminals (node-pty).
- **Shared memory:** `.tributary/memory.md` holds project facts, and `.tributary/worklog.md` logs who did what. AGENTS.md points every agent to both. "Remember this" on any reply adds a note.
- **Model gateways:** point agents at LiteLLM, Ollama, LM Studio, DeepSeek, OpenRouter or any OpenAI, Anthropic or Gemini compatible endpoint. Keys are encrypted with the system keychain.
- **Agent registry:** Settings, Agents, **Browse agents** lists the [Agent Client Protocol registry](https://agentclientprotocol.com). Agents published for npx or uvx install with one click and download on first use; binary-only agents are not supported yet.
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
| Anything else | Add it to `agents.json` (Settings, Agents, Add a custom agent), with protocol `text`, `acp`, `claude-stream`, `codex-exec` or `gemini-stream`. `{prompt}`, `{cwd}` and `{mode}` in its args are filled in. |

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

Work on two things at once, each in its own worktree and branch, and merge each when it is ready. A plain `ask` continues the latest thread in its copy; `merge` without `-t` takes the latest thread that has a copy:

```bash
tributary ask --separate -a claude "add input validation to the signup form"
tributary ask --separate -a codex "upgrade the date library"
tributary merge
```

| Command | What it does |
|---|---|
| `ask [-a agent] "request"` | One turn in this folder. `-m read\|edit\|full` sets the permission mode, `--plan` plans without changing anything, `--new` starts a new thread, `--separate` starts one in its own git worktree and branch (with `-t`, moves that thread there), and `-` reads the request from stdin |
| `merge [-t thread]` and `discard [-t thread]` | Merge a thread's separate copy into this folder's current branch (exits 1 and names the files on a conflict), or delete the copy and its branch |
| `race -a a,b [--test cmd] "task"` and `apply <agent>` | Race agents in separate worktrees, then apply one result |
| `agents` | Installed agents and their versions |
| `threads`, `show`, `export -o file` | List (with each thread's branch, if it has a separate copy), print or save threads |
| `diff`, `undo` | What the last turn changed, and restoring files to before it |
| `memory`, `memory enable`, `memory remember "note"` | Shared project memory in `.tributary/memory.md` |
| `mcp`, `skills`, `registry [add\|remove <id>]`, `doctor` | MCP servers, skills, ACP registry agents, and a setup check |

Every command accepts `--json`, `-C <dir>` and `--no-color`. Ctrl+C stops the running agent and keeps what it wrote so far.

The CLI uses the desktop app's data folder (`~/.config/Tributary` on Linux, `~/Library/Application Support/Tributary` on macOS, `%APPDATA%\Tributary` on Windows), so a thread started in the app continues in the terminal and the other way round, even with both open. `--data-dir` or `TRIBUTARY_DATA_DIR` picks another folder. Threads from the separate `Tributary/cli` folder that earlier versions used are imported the first time.

Gateway keys saved in the app are encrypted with the system keychain, which a terminal cannot read. The CLI keeps its own keys in `cli-secrets.json` in the data folder, readable only by your user.

## Where data lives

Projects, threads, gateway settings (never their keys), notifications and preferences are stored in `tributary.db`, a SQLite database in the data folder that only your user can read. Each process writes only the rows it changed, so the desktop app and the CLI can work at the same time; each picks up the other's changes within a second. If both change the same thread title or setting at once, the later save wins; messages from both are always kept.

On first start, the `hub.json` file older versions wrote is imported once and kept as `hub.json.migrated`. On a Node.js without `node:sqlite` (older VS Code builds), Tributary falls back to `hub.json`, which supports one process at a time.

## Tests

```bash
npm test
```

The suite covers the stream parsers (with recorded output from the real agents), handoff, gateways, the process runner, the ACP client and pool, teams, race mode in worktrees, separate working copies (two conversations writing at once, merging back, and conflicts), checkpoints, memory, MCP, skills, the registry client and Browse agents calls, thread status, the shared SQLite store (migration, and two processes writing at once), the terminal manager, editor detection, the command line, and the VS Code extension (against a stand-in `vscode` module). Two scripts run real agents and use a little of your quota:

```bash
npm run test:e2e
```

```bash
node test/e2e/real-race.js /tmp/tributary-data /tmp/tributary-race claude codex
```

Smoke mode starts the desktop app in a hidden window, prints a JSON report (including startup time, memory per process and renderer errors) and saves a screenshot. `TRIBUTARY_SMOKE_SEND` starts turns, team runs or races from the main process with an explicit agent id, so a check can watch agents work without typing into the app. `TRIBUTARY_SMOKE_CLICKS` clicks buttons by label first (a number waits that many milliseconds), which is how to check a screen such as Browse agents:

```bash
TRIBUTARY_DATA_DIR=/tmp/tributary-smoke TRIBUTARY_SMOKE_SHOT=/tmp/browse.png TRIBUTARY_SMOKE_CLICKS="Settings|Agents|Browse agents|4000" npm start -- --smoke-test
```

Use a new, empty `TRIBUTARY_DATA_DIR` for each run so earlier runs do not change what you see. To check separate working copies, pass a git repository with at least one commit as the project. This turns on a copy for a new conversation, then opens the discard confirmation by turning it off:

```bash
TRIBUTARY_DATA_DIR=$(mktemp -d) TRIBUTARY_SMOKE_SHOT=/tmp/copy.png TRIBUTARY_SMOKE_CLICKS="2500|Work in a separate copy|2500|Work in a separate copy|800" npm start -- /path/to/repo --smoke-test
```

With a conversation that already has a copy (start one with `tributary ask --separate` and the same data folder), `Branch tributary|Merge into main|Merge` opens its status, merges it, and shows any conflict in the status popover.

## Layout

| Folder | What is in it |
|---|---|
| `core/` | Agent registry and detection, stream parsers, runner, ACP client, handoff, hub, SQLite store, thread status, git checkpoints, race, separate working copies (`worktrees.js`), teams, memory, MCP, skills, gateways, registry, terminal, editors |
| `desktop/` | Electron main process and the preload bridge |
| `cli/` | The `tributary` command line |
| `ui/` | React, Tailwind and shadcn/ui interface, shared by the desktop app and the extension |
| `vscode/` | VS Code extension: webview host, bridge and build script |
| `test/` | node:test suites, fake agents and recorded fixtures |
| `docs/` | Research notes, improvement plan and performance work |

## Security notes

- Agents run with your user's permissions. Read-only and Edit modes map to each agent's own permission settings; Full auto approves everything, so use it only in projects you trust.
- API keys for gateways are stored encrypted with the OS keychain when available, never in `tributary.db`.
- MCP listings mask keys, tokens and header values.
- The window runs with context isolation and sandboxing, and the page can only call an allowlisted set of methods.

## Research

- [docs/MULTI_AGENT_LANDSCAPE.md](docs/MULTI_AGENT_LANDSCAPE.md): competing apps, what makes multi-agent coordination work, and patterns read from open-source apps' source.
- [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) and [docs/PERFORMANCE_ARCHITECTURE.md](docs/PERFORMANCE_ARCHITECTURE.md): product and performance plans.
