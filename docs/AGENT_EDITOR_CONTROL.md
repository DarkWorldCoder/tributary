# Agent control of the editor

Trusted desktop coding chats automatically receive an editor connection for the current turn. Local tool-calling models receive the structured `editor` tool. Other coding agents receive a command bridge in their prompt and environment, usable through their normal shell tool. No global agent configuration is changed.

| Action | Result |
| --- | --- |
| `status` | Open groups, selected files and unsaved-file flags |
| `open_file` | Open a project-relative file at a line and column in the selected pane |
| `read_editor` | Current unsaved buffer, cursor, undo availability and revision; bounded line range |
| `edit_editor` | Replace one exact occurrence in the open buffer with normal undo history |
| `save_editor` | Save through the existing file-conflict and formatting rules |
| `undo`, `redo`, `format` | Use the real editor history and configured formatter |
| `split_editor`, `focus_group` | Split right/down and navigate numbered groups |
| `show_panel` | Open files, changes, memory, preview, tests, terminal or debugger |

The agent reads the buffer first, then supplies its path and revision with a change. A revision becomes invalid when the document changes or its editor is recreated. New user typing therefore cannot be overwritten by an older agent request. An edit changes the unsaved buffer; saving remains a separate action. Reads report truncation and return at most 200 lines / 12,000 characters. Each replacement is limited to 120,000 characters per argument.

Edit-files mode asks through the existing permission UI before buffer changes, formatting, saving or history actions. Read-only mode permits navigation and inspection. Full-auto mode retains its existing trusted-project behavior. The connection is limited to the agent's working folder and current turn, accepts one command at a time, and closes on turn completion. Commands are acknowledged by the actual workspace rather than reported as successful when merely queued. Selecting another chat prevents background editor takeover. In a multi-folder workspace, the agent's own working root is selected before handling its editor request.

Files, tests, terminal commands, worker delegation and debugger execution continue through the agent's existing tools and approval flows. Showing a panel does not execute its scripts. This connection does not automate approval buttons or evaluate arbitrary UI JavaScript. It currently targets the Tributary desktop editor; remote hosts, the VS Code extension's native editors, browser-page automation and arbitrary extension controls are outside this API. A provider must support structured tools or shell execution to use it.

## Verification

The core tests cover local tool routing, a real native child process using its injected turn bridge, acknowledgements, invalid paths/actions, read-only mode, approval denial, authenticated loopback requests, cancellation and turn cleanup. The isolated Electron fixture uses real CodeMirror instances and temporary project files to verify stale-edit rejection, preservation of unsaved typing, exact undo/redo, formatting, disk saves, line/column navigation, splitting, group focus, multi-folder selection and refusal to control a different visible chat.

Run the desktop fixture after building the UI: `xvfb-run -a node_modules/.bin/electron test/e2e/agent-editor.cjs --ozone-platform=x11` on Linux. It does not invoke a paid provider or touch the installed user profile. Native macOS/Windows windows and installers require separate verification.

The full regression run passed 612 tests. After the final cancellation/command-helper refinements, the focused local-agent, permissions and editor-bridge run passed 22 tests; the final bridge rerun passed all five cases. TypeScript and the production UI build pass. The real-editor fixture passes six grouped checks, including a deliberately delayed formatter released after Stop. Search and split fixtures pass 15 and 16 grouped checks respectively. Screenshots were inspected. These are Linux source-build checks; no live paid provider, installer or native macOS/Windows test is claimed.

[Editor verification](performance/agent-editor-verification.json) · [Editor panes](performance/agent-editor-control.png) · [Search verification](performance/editor-search-controls-verification.json) · [Split verification](performance/editor-split-controls-verification.json).
