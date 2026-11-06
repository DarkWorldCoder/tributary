![Tributary — every coding agent, one stream of work](docs/media/tributary-flow.svg)

**Your agents. Your files. One workbench.**

Switch coding agents, work in parallel, and review real changes in the same project.

[Download preview](https://github.com/DarkWorldCoder/tributary/releases) · [Get started](#get-started) · [Benchmarks](BENCHMARKS.md) · [Guide](docs/GUIDE.md) · [Contribute](CONTRIBUTING.md)

[![MIT license](https://img.shields.io/badge/license-MIT-4338ca?style=flat-square)](LICENSE) ![macOS, Windows and Linux](https://img.shields.io/badge/desktop-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-176b91?style=flat-square) ![Preview software](https://img.shields.io/badge/status-preview-9a6700?style=flat-square)

![Tributary workbench with the actual repository file explorer, source editor and chat](docs/media/workbench.png)

*Tributary editing its own repository. The file list stays visible; it can also be hidden without closing your files.*

## One project, many ways to work

| | What you can do |
| --- | --- |
| **Keep the conversation** | Switch between installed agents with project context and conversation handoffs. |
| **Share the work** | Start agent teams from chat; run background tasks in separate Git working copies and review before merging. |
| **Stay in your editor** | Browse multiple folders, split editors, search files, inspect live edits and undo changes. Show or hide the file explorer from the editor toolbar. |
| **Run and check** | Use split terminals, project checks, a Node.js debugger, a preview browser and QA result views. |
| **Work locally** | Connect Ollama, LM Studio or Unsloth; use local chat or the built-in coding agent with file tools and command approvals. |
| **Work together** | Host a project room from the app, invite teammates on your network and coordinate tasks. Agents run on their owners’ computers. |

## Get started

1. **[Download a preview](https://github.com/DarkWorldCoder/tributary/releases)** for your computer and install it.
2. **Open a folder.** Connect an installed coding agent in Settings → Connections, or set up a local model.
3. **Start a task.** Ask a question, edit files, or create an agent team. Review the diff and checks as you work.

| System | Architectures | Downloads |
| --- | --- | --- |
| macOS | Apple Silicon / Intel | `.dmg` installer, `.zip` containing the app |
| Windows | x64 / Arm64 | `.exe` installer, portable `.zip` |
| Linux | x64 / Arm64 | `.deb`, `.AppImage`, `.tar.gz` |

Preview builds are unsigned/not notarized. See [installation and removal](docs/UNINSTALL.md), [updates inside the app](docs/APP_UPDATES.md) and the release’s `SHA256SUMS.txt`. Packaged apps include their runtime; Git is needed for repository features. GitHub downloads currently require access to this private repository.

## Bring your own agent

Tributary uses the agent’s supported local CLI or protocol. Your provider account and model access stay with that agent; availability and supported tools depend on its adapter.

| Agent | Connection |
| --- | --- |
| Claude Code | Native streaming/control protocol |
| Codex | App-server integration and CLI fallback |
| Gemini CLI / Antigravity | Their supported headless or ACP integration |
| OpenCode, Kimi, Goose, Qwen Code and others | Agent Client Protocol; browse compatible agents in Settings |
| Local or compatible model endpoints | Built-in chat/coding tools with configurable approvals and context budgets |

[Native agent behavior](docs/NATIVE_AGENT_BEHAVIOR.md) · [Delegation and background work](docs/AGENT_DELEGATION.md) · [Local model setup](docs/LOCAL_MODELS.md)

## A workbench you can move around

![Real Tributary source in split editors with the project file list visible](docs/media/split-editors.png)

**Quick Open** `Ctrl/Cmd+P` · **Commands** `Ctrl/Cmd+Shift+P` · **Find in file** `Ctrl/Cmd+F` · **Show Explorer** `Ctrl/Cmd+Shift+E` · **Split editor** `Ctrl/Cmd+\`

Use the explorer’s hide button or the editor’s sidebar button to make room. Your tabs, drafts and undo history stay open. [More shortcuts](docs/KEYBOARD_SHORTCUTS.md), [formatting](docs/WORKSPACE_FORMATTING.md), [agent editor controls](docs/AGENT_EDITOR_CONTROL.md) and [QA workflows](docs/QA_RESULTS.md).

**Project-local tools:** read `.vscode/settings.json`, Prettier and EditorConfig; show live ESLint problems, apply undoable fixes, and configure formatting separately from fix-on-save. Set up ESLint for each workspace folder in **Settings → Language tools**. [Setup and supported settings](docs/PROJECT_ESLINT.md).

## Compare the same large-project workload

![Tributary, VS Code and Zed in the same controlled large-project navigation test](docs/media/editor-comparison.svg)

The comparison uses the **same generated project with 20,008 TypeScript files**, a **40,001-line source file**, clean app profiles and three fresh instances per editor. It checks actual opened contents and navigation to the end of the large file, then samples application process memory separately.

VS Code completed these workflows faster; Zed used less app memory. Tributary’s slowest file search took 9.58 seconds and remains in the published results.

These Linux/Xvfb workflows include image/clipboard verification overhead. Zed uses emulated Vulkan here, so this is **a controlled headless test, not a hardware-GPU ranking or exact typing-latency comparison**. The [benchmark guide](BENCHMARKS.md) keeps versions, every run, settings, controls, raw results and reproduction instructions visible—including results where another editor does better. Historical before/after Tributary optimizations are listed separately.

## Build from source

Use **Node.js 24**, npm and Git. Run these commands from the repository root:

```sh
npm ci
npm ci --prefix ui
npm start
```

After building, open a specific project with `npm run dev -- /absolute/path/to/project`.

```sh
npm test                                      # Core regressions + extension build
npx --prefix ui tsc --noEmit -p ui/tsconfig.json # UI type check
npm run vscode:install                        # Build/install the companion extension
```

The [full guide](docs/GUIDE.md) covers the CLI, separate working copies, shared secrets and data locations. [Contributing](CONTRIBUTING.md) explains tests and native UI checks. [Release automation](docs/RELEASING.md) builds a versioned preview for each successful main push, with all six platform/architecture variants and checksums.

## Project notes

- **Status:** preview. [Feature status](docs/FEATURE_STATUS.md) records foundations and remaining work.
- **Privacy and permissions:** files are local; prompts and selected context go to the agent/provider you choose. Review tools and connection settings. [Security](SECURITY.md).
- **License:** [MIT](LICENSE). Third-party components retain their own licenses. Tributary is independent of the agent and editor projects it integrates with.
- **Design references:** the short installation/contribution path in [Zed’s README](https://github.com/zed-industries/zed/blob/main/README.md) and the visual introduction in [OpenCode’s README](https://github.com/anomalyco/opencode/blob/dev/README.md). All screenshots here show Tributary; branding and artwork are ours.
