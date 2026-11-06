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
- **Pull requests.** In a separate copy's branch popover, **Create pull request** commits the copy's work, checks it with the secret guard, pushes the branch and opens a pull request into the branch the copy came from. The selected agent drafts the title and description in a read-only turn. The popover then lists the pull request's checks: **Fix failing CI** hands the agent the last 200 lines of each failed GitHub Actions run's log, and **Push changes** sends its fix. Once the pull request is merged, the popover offers to discard the copy. It goes through the GitHub CLI (`gh`) and the sign-in you already have, so Tributary never handles a token; if `gh` is missing or signed out, it says so.
- **Copies that run.** A new copy gets the project's gitignored `.env` files (or whatever `.worktreeinclude` lists), its own block of ten ports (`$TRIBUTARY_PORT`, also set as `$PORT`) for agents and terminals in it, and the project's setup script once you trust it. Copied files are never committed. See [Copies that run](#copies-that-run).
- **Secret guard.** Agents commit with hooks off, so Tributary checks what a merge from a copy, or **Commit all**, would add: values from the project's `.env` files whose names say they're secret, and well-known token shapes (private keys, AWS, GitHub, Slack, OpenAI and Anthropic, Google). A hit is refused, naming the file and the kind of secret but never the value, until you choose **Merge anyway** or **Commit anyway**. Agent output is redacted as it streams, so transcripts show `[REDACTED]`.
- **Team secrets.** A team shares a project's secrets as an encrypted file in the repository, one age key per member, made with SOPS. Agents and terminals get the values as environment variables, transcripts redact them, and removing a member rotates the file's key. See [Team secrets](#team-secrets).
- **Review loop.** In either Changes view, hover a line and press **+** to comment. Comments go to the agent as one message (`@path:line`, the line, your note): to the agent whose turn made the change, or the selected agent for the working tree. **Review with an agent** has another agent review everything the conversation changed, read-only, and its findings become comments on those lines. A copy that conflicts with the project's branch says so before you merge; **Resolve with** an agent merges that branch into the copy and has the agent fix the markers there, so your folder never sees one.
- **Checks after every turn.** Name a `verify` script in `.tributary/settings.json` and, once you trust it, it runs in the background after each turn that changed files. The turn shows **Checks passed**, or **Checks failed** with the output and a **Fix** button that hands it to the same agent.
- **What needs you.** A chip names the conversations waiting for your OK, failed, or finished with changes to review, across every project; Ctrl/Cmd+Shift+J opens the next one. System notifications come only when an agent is blocked (finished turns still go to the bell), and the computer stays awake while agents run.
- **Safety.** A git checkpoint is taken before every turn and can be restored. Another is taken when the turn ends, so blame and the Changes tab never credit your later edits to the agent. Permission modes are Read-only, Edit files and Full auto. Plan mode plans first and runs after you approve.
- **Agent-aware editor:** a blame gutter shows which agent's turn last changed each line (hover for the request and conversation; click a bar for **Open conversation** or **Undo this change**, or press Ctrl+Alt+Z (⌘⌥Z) on a line an agent wrote; Alt+B hides it). Undo puts back only what that turn changed in that spot, leaves the rest of the file and other agents' lines alone, and refuses if those lines changed since; Ctrl/Cmd+Z brings the change back as an unsaved edit. When an agent edits the open file, only the changed lines update and light up, your cursor stays where it was, and a notice says which agent is editing. Select code and press Ctrl/Cmd+L (or click **Ask an agent**) to send it to the message box. Language support loads when a file of that kind opens.
- **Agent editor controls.** Trusted desktop coding agents can inspect unsaved buffers, open files, split/focus panes, edit with undo, format and save through a turn-scoped connection. Revisions protect newer typing; approvals and Stop still apply. See [Agent editor control](docs/AGENT_EDITOR_CONTROL.md).
- **Tool approval.** When an ACP agent asks to run a command or use a tool that the permission mode doesn't cover, the request appears in the running turn. You pick **Allow once**, **Always allow** (for the rest of that agent session) or **Deny**, and stopping the turn cancels it. Edit files mode still allows edits without asking, and Read-only still declines them. Full auto never asks. Claude Code and Codex get this through their ACP adapters (`claude-acp` and `codex-acp` in Browse agents); [docs/TOOL_APPROVAL.md](docs/TOOL_APPROVAL.md) describes how their own protocols would plug in.
- **Live activity:** while agents work, a pill shows how many are running. It opens a view of every agent across conversations, teams, races and managed runs: what each one is doing now, the files it changed, and each file's diff as it changes.
- **Thread status:** the sidebar marks each thread as working, waiting for your approval, needs review (it finished with file changes you have not opened yet), failed, or done.
- **Workspace panel:** Review (uncommitted changes and commit), Changes (exactly what each turn changed), Files (a CodeMirror code editor with previews for Markdown, images and HTML), Memory, and Preview (your local dev server).
- **Files:** hidden and ignored files (including `.env`) are visible in the explorer by default. Use **New file** / **New folder**, or right-click a folder. **Ctrl/Cmd+P** finds project files, including ignored environment files; Explorer options can hide dotfiles.
- **Terminal:** xterm.js with GPU rendering on real pseudo-terminals (node-pty). Split into up to four independent panes using **Split terminal** or **Ctrl/Cmd+Shift+5**; **Ctrl/Cmd+Shift+`** opens a separate terminal. The terminal docks inside the editor area, leaving chat full height. Hiding the panel keeps shells and split panes running.
- **Shared memory:** `.tributary/memory.md` holds project facts, and `.tributary/worklog.md` logs who did what. AGENTS.md points every agent to both. "Remember this" on any reply adds a note.
- **Model gateways:** point agents at LiteLLM, Ollama, LM Studio, DeepSeek, OpenRouter or any OpenAI, Anthropic or Gemini compatible endpoint. Keys are encrypted with the system keychain.
- **Agent registry:** Settings, Agents, **Browse agents** lists the [Agent Client Protocol registry](https://agentclientprotocol.com). Agents published for npx or uvx install with one click and download on first use; binary-only agents are not supported yet.
- **MCP and skills:** see every agent's MCP servers side by side and add one to several agents at once through each agent's own `mcp add` command. Skills are merged across agents and can be shared with all of them. Project `.mcp.json` servers are passed into ACP sessions.
- **Tasks and documents:** guided tasks for non-coding work (summarize, compare, write, translate, study) and saved documents you can export.
- **Also:** `@` file mentions, `/` commands and skills, a command palette (Ctrl/Cmd+Shift+P or F1), notifications, message queueing, retry, export to Markdown, extra project folders, and opening a file in VS Code, Cursor or Windsurf.

## Requirements

- Linux, macOS or Windows with Node.js 20 or newer and git.
- For [team secrets](#team-secrets) only: [`sops`](https://getsops.io/docs/) on your PATH (`brew install sops`).
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

Every command accepts `--json`, `-C <dir>` and `--no-color`. Ctrl+C stops the running agent and keeps what it wrote so far. The command line can't show tool approval requests, so a request the permission mode doesn't allow is declined, and the turn shows a `Declined:` notice.

The CLI uses the desktop app's data folder (`~/.config/Tributary` on Linux, `~/Library/Application Support/Tributary` on macOS, `%APPDATA%\Tributary` on Windows), so a thread started in the app continues in the terminal and the other way round, even with both open. `--data-dir` or `TRIBUTARY_DATA_DIR` picks another folder. Threads from the separate `Tributary/cli` folder that earlier versions used are imported the first time.

Gateway keys saved in the app are encrypted with the system keychain, which a terminal cannot read. The CLI keeps its own keys in `cli-secrets.json` in the data folder, readable only by your user.

## Copies that run

A separate copy starts from the last commit, so it lacks the files a project needs that git ignores. Tributary copies them in when the copy is made:

- **`.worktreeinclude`** at the repository root lists them in gitignore syntax, with `!` to leave some out. It's the same file Claude Code, the Codex app and Conductor read. Without it, the gitignored `.env` files are copied. Only files git ignores are copied, never symlinks or folders, and they're readable by you only. Commits from the copy leave them out even if an agent un-ignores them.
- **Ports.** Each copy takes ten ports from 4400 up: `$TRIBUTARY_PORT` to `$TRIBUTARY_PORT + 9`, with `$PORT` set to the first. `$TRIBUTARY_WORKSPACE` and `$TRIBUTARY_ROOT_PATH` name the copy and the project. Agents and terminals in the copy see them; the project folder keeps its usual ports.
- **`.tributary/settings.json`**, committed so the team shares it, names the project's scripts:

```json
{ "scripts": { "setup": "npm ci", "verify": "npm test" } }
```

`setup` runs in every new copy, in the background. `verify` runs after each turn that changed files. Each runs only after you've trusted its exact text (the copy's branch popover, or the turn, shows it first); a changed script asks again.

## Team secrets

Copies that run share `.env` files on one computer. To share secrets with teammates, commit them encrypted. `.tributary/secrets.env` is a dotenv file encrypted with [SOPS](https://getsops.io/docs/) and [age](https://age-encryption.org). Anyone can read its variable names, but only a member's key opens the values. `.sops.yaml` lists one age key per member. Commit both files. You need `sops` on your PATH. Tributary also looks in Homebrew's folder when it's started from the desktop.

- **Your key.** In Settings, **Team secrets**, choose **Create my key**. The private half stays in the system keychain. The public half (`age1…`) is shown so you can copy it. If you're in a [project room](docs/PROJECT_ROOMS.md), **Share in** publishes the public half so teammates see it next to your name. The room's server stores only that.
- **Members.** **Start team secrets** writes a `.sops.yaml` that lists you. To add a teammate, a member enters their name and public key, or uses **Add** next to a key shared in the room. Tributary then runs `sops updatekeys` so the new member can open the file. Only a member can add someone.
- **Values** are write-only in the window. You can add, replace or remove one by name, but Tributary never shows a value. Each save encrypts the file again with a new data key.
- **Where values go.** Before each turn, Tributary decrypts the file in memory and gives the values to the agent as environment variables. Terminals opened in the project, or in one of its copies, get them too. Decryption runs `sops decrypt` with your key in its environment, never on its command line or on disk. A copy's own `$PORT` and paths win over a team value with the same name. The [secret guard](#what-it-does) learns every value, whatever its name: transcripts show `[REDACTED]`, and merges and **Commit all** refuse to add one. If you can't open the file, turns still run without the values, and the turn says why.
- **Removing someone.** Removing a member drops their key and runs `sops updatekeys`, then `sops rotate`, so the file gets a new data key they never had. **That isn't enough by itself.** They could read every value until then, and git history keeps the old encrypted file, which their key still opens. Change each value where it was issued (a new API key, a new database password), then save the new value here. Tributary lists the names to change.

Limits: each Tributary app (desktop, VS Code, CLI) keeps its own key, so add each one you use. If a repository's `.sops.yaml` wasn't written by Tributary, Tributary still reads the file and sets values, but you change its keys by hand. SOPS's dotenv format turns a literal `\n` in a value into a newline. Two people saving values at once makes a git conflict in the encrypted file: keep one side and save the other change again.

## Where data lives

Projects, threads, gateway settings (never their keys), notifications and preferences are stored in `tributary.db`, a SQLite database in the data folder that only your user can read. Each process writes only the rows it changed, so the desktop app and the CLI can work at the same time; each picks up the other's changes within a second. If both change the same thread title or setting at once, the later save wins; messages from both are always kept.

On first start, the `hub.json` file older versions wrote is imported once and kept as `hub.json.migrated`. On a Node.js without `node:sqlite` (older VS Code builds), Tributary falls back to `hub.json`, which supports one process at a time.

## Tests

```bash
npm test
```

The suite covers the stream parsers (with recorded output from the real agents), handoff, gateways, the process runner, the ACP client and pool, tool approval requests, teams, race mode in worktrees, copies that run (copied `.env` files, ports, trusted setup scripts), the secret guard, team secrets (two members, removing one, values in a turn's environment; skipped without `sops`), review comments and reviewer agents, resolving a copy's conflicts, checks after each turn, what needs you, separate working copies (two conversations writing at once, merging back, and conflicts), pull requests (against a stand-in `gh`), checkpoints, memory, MCP, skills, the registry client and Browse agents calls, thread status, the shared SQLite store (migration, and two processes writing at once), the terminal manager, editor detection, the command line, and the VS Code extension (against a stand-in `vscode` module). Two scripts run real agents and use a little of your quota:

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

To see a copy's pull request without GitHub, put a `gh` that runs `test/fake-gh.js` first on `PATH` and point `FAKE_GH_STATE` at a JSON file of pull requests and checks (the file's header comment describes it). Then `Branch tributary|Create pull request|Push and create` creates one, and `Branch tributary` shows its checks.

`TRIBUTARY_SMOKE_PROMPT` sends a message first, and `TRIBUTARY_SMOKE_AGENT_NAME` picks the agent for it. Smoke mode waits until the turn finishes, or until it asks for permission, so the clicks can answer it. To see a tool approval request, use a new data folder with the fake ACP agent from the tests in its `agents.json`. `RUN <command>` makes that agent ask to run the command:

```bash
mkdir -p /tmp/tributary-approve /tmp/approve-project
echo "{ \"agents\": [{ \"id\": \"fake-acp\", \"name\": \"Fake ACP\", \"command\": \"$(which node)\", \"protocol\": \"acp\", \"acpArgs\": [\"$PWD/test/fake-acp.js\"] }] }" > /tmp/tributary-approve/agents.json
TRIBUTARY_DATA_DIR=/tmp/tributary-approve TRIBUTARY_SMOKE_SHOT=/tmp/approve.png TRIBUTARY_SMOKE_PROMPT="RUN npm test" TRIBUTARY_SMOKE_AGENT_NAME="Fake ACP" TRIBUTARY_SMOKE_CLICKS="Allow once|1500" npm start -- --smoke-test /tmp/approve-project
```

Leave out `TRIBUTARY_SMOKE_CLICKS` to capture the request while it is still waiting.

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
- In the desktop app and VS Code, an ACP agent's request to run a tool that the mode doesn't cover waits for your answer. The command line declines these requests.
- API keys for gateways are stored encrypted with the OS keychain when available, never in `tributary.db`. On Linux with no keyring running, Electron would fall back to a fixed password; Tributary then keeps new keys for the session only.
- Merges from a copy, pushes for a pull request and **Commit all** are checked for secrets first, and agent output is redacted (see **Secret guard**).
- Team secrets are decrypted only in memory, for agents and terminals. The window only ever sees variable names and public keys (see [Team secrets](#team-secrets)).
- Setup and verify scripts from `.tributary/settings.json` never run until you have trusted their exact text.
- MCP listings mask keys, tokens and header values.
- An MCP server's environment and header values are stored in Tributary's secret store, never in an agent's config. Each config gets a placeholder in that agent's syntax: `${VAR}` for Claude Code, `$VAR` for Gemini CLI, `env_vars` or `bearer_token_env_var` for Codex. Tributary gives the values only to the turns it starts, and the secret guard redacts them. Antigravity has no documented placeholder, so servers with secrets are not added to it.
- The window runs with context isolation and sandboxing, and the page can only call an allowlisted set of methods.

## Research

- [docs/research/2026-11-agent-workflows.md](docs/research/2026-11-agent-workflows.md): what developers struggle with when running several agents, what 16 competing apps do, sharing `.env` and config across a team, and what makes agents more effective, with sources.
- [docs/MULTI_AGENT_LANDSCAPE.md](docs/MULTI_AGENT_LANDSCAPE.md): competing apps, what makes multi-agent coordination work, and patterns read from open-source apps' source.
- [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) and [docs/PERFORMANCE_ARCHITECTURE.md](docs/PERFORMANCE_ARCHITECTURE.md): product and performance plans.
- [docs/UI_IMPROVEMENTS.md](docs/UI_IMPROVEMENTS.md): implemented interface polish, included UI skills, component references and screenshots.
- [docs/PROJECT_ROOMS.md](docs/PROJECT_ROOMS.md): local shared-room setup, collaboration scope and current limits.
- [docs/COORDINATION_AND_MEMORY.md](docs/COORDINATION_AND_MEMORY.md): conflict-aware memory, team history, live file views and connector diagnostics.
- [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md): all 80 roadmap candidates, their implemented scope and remaining work.
- [docs/TOOL_APPROVAL.md](docs/TOOL_APPROVAL.md): how tool approval works for ACP agents, and how Claude Code's stdio control protocol and `codex app-server` would plug into it.

### Distribution builds

Local model setup: **Settings → Connections → Set up local models** supports
Unsloth, Ollama, LM Studio and llama.cpp. On desktop, start an existing GGUF CPU
model from the app, release it when idle and wake it for the next chat.
See [local models](docs/LOCAL_MODELS.md) and
[memory efficiency and benchmark](docs/MEMORY_EFFICIENCY.md).

[Download preview releases](https://github.com/DarkWorldCoder/tributary/releases).
The repository is private, so downloads currently require repository access.

[Uninstall instructions for Windows, macOS and Linux](docs/UNINSTALL.md).

From 0.1.2, use **Help → Check for updates** or **Settings → About** to check,
download and verify an installer inside the app. Automatic checks are optional;
installation stays under your control. See [in-app updates](docs/APP_UPDATES.md)
for private GitHub access and platform details. Install 0.1.2 manually once if
you are on 0.1.1.

The Distribution workflow builds macOS (Intel and Apple Silicon), Windows
(x64 and ARM64), and Linux (x64 and ARM64), then verifies the packaged runtime
and publishes downloads with SHA-256 checksums. Release tags must match the
package version, for example `v0.1.0`. A release is published only after all six
builds pass.

Local packaging: `npm ci`, `npm ci --prefix ui`, then `npm run dist:mac`,
`npm run dist:win`, or `npm run dist:linux` on the corresponding OS.
See [preview release notes](docs/releases/preview.md) for formats, requirements
and the current signing limitations. These are preview builds, not notarized
or developer-signed production installers.

### Themes and file icons

Open **Settings → Extensions**, search Open VSX, then select **Install**. Choose an installed **Color theme** or **File icons** from the selectors below the results. Downloads, checksum checks and installation happen inside Tributary; no manual VSIX upload is needed. **From file…** remains available for offline packages.

Tributary imports compatible theme and icon contributions. Extensions that require the VS Code extension host do not run inside Tributary. Configure supported language servers and formatters in **Settings → Language tools**.

### Reviewing changes

**Changes** opens one source-control view: changed files and the commit box on the left, with the selected comparison beside them. The explorer's **Changes** button opens that same view. **Conversation activity** shows which agent changed each file; **Review saved changes** in the editor compares a single file.
