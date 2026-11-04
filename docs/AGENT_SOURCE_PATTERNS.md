# Agent source patterns

Source review: 3 November 2026. These are compatibility changes; upstream agent code is not embedded in Tributary.

| Source | Observed pattern | Tributary behavior |
| --- | --- | --- |
| [Kimi ACP session](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/acp/session.py) | Tool titles include the tool name; running content carries cumulative JSON arguments. Completion content carries results. | Recognized arguments become structured input. Incomplete input stays out of output. Completion JSON remains output. |
| [OpenCode ACP tools](https://github.com/anomalyco/opencode/blob/6d1c444b8c53da667b51ed45b0a7c0aca1174674/packages/cli/src/acp/tool.ts) | Tool names, kinds, locations and input arrive separately; completion can omit previous fields. | Stable tool identity and merged input across updates. Read/edit locations support Follow and file links. Shell working directories are excluded from file changes. |
| [Kimi ACP setup](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/docs/en/reference/kimi-acp.md) | Native `kimi acp` server and terminal `kimi login`. | Existing ACP adapter retained; Kimi has a direct terminal sign-in action. |

Commands remain data for display and permission prompts. Normalization never executes command strings. Native agents still own their execution and subagent runtimes; Tributary supplies shared navigation, approvals and team orchestration.

Verification: local protocol fixtures cover partial arguments, status-only updates, command metacharacters, file locations, process reuse and session recovery. This does not certify a live authenticated Kimi/OpenCode run on every version.


## File sidebar and editor layout

- [Kimi session files panel](https://github.com/MoonshotAI/kimi-cli/blob/main/web/src/features/chat/components/session-files-panel.tsx): directory requests retain explicit path, refresh and error state. Tributary retains its paged directory tree and in-place refresh rather than clearing the sidebar.
- [VS Code explorer renderer](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts) and [Outline pane](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/outline/browser/outlinePane.ts): file decorations and a separate symbol view. Tributary adds Git/unsaved markers, changed-folder indicators, and a collapsible current-draft outline with cursor navigation.
- [OpenCode workspace file model](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/workspaces/files/model.tsx): file and view state belongs to a workspace scope. Tributary preserves its per-project tab/draft state and filters Git decorations to the current folder, including nested repositories and worktrees.

The editor footer now keeps cursor position and Save visible, moves secondary actions into an overflow menu in narrow readers, and exposes full language/indentation/encoding details in a popover. Format document edits the draft; it does not automatically save source files.

## November 3: reviewable coordination and browser preview

- Activity now distinguishes agents working from pending approvals, retains task dependency titles and preserves failed/skipped outcomes after a run leaves the live list.
- Parent chats show actual delegated-worker branches, errors and file totals; worker chat/review/stop actions target that child chat.
- Preview uses compact browser tabs with per-tab address history, preserved mounted pages when switching workspace tools, device sizes and an overflow menu.
- Desktop preview Start/Stop/Restart controls own only the dev/start process they launch, through the existing process-tree lifecycle. Output is bounded to 32K characters and local addresses are detected from real output. This is a local iframe preview, not a general browser, recorder or QA automation engine. Back/Forward traverse addresses opened through the address bar; in-page cross-origin history is not observable by this surface.
- Future product strategy and the first-class QA workflow are proposed in [PRODUCT_DIFFERENTIATION_PLAN.md](PRODUCT_DIFFERENTIATION_PLAN.md) and [QA_WORKSPACE_RESEARCH.md](QA_WORKSPACE_RESEARCH.md).

Validation for this pass: TypeScript, production build and `git diff --check` passed. The full regression suite passed 335 cases; the final targeted run passed 15 cases, including an additional team-approval check added afterward. Isolated UI checks covered local server launch/restart/stop, separate preview histories, retained page input across tool switches, invalid addresses, six viewport widths, compact team setup, approval states and mobile change previews. Browser navigation remains address-history navigation; staging automation and the QA roadmap are proposed separately.

## Full-screen and focused workspace controls

- [Zed's panel zoom](https://zed.dev/blog/new-panel-system) and [current actions](https://zed.dev/docs/all-actions): a pane can occupy the window, with a zoom control in its tab bar and a command-palette action. Tributary's Focus workspace covers the surrounding chrome while preserving the mounted editor, terminal and preview pages. Restore layout or Escape restores the previous split and its saved width.
- [VS Code Zen mode](https://code.visualstudio.com/docs/editing/getting-started/userinterface#_zen-mode) and [layout actions source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/layoutActions.ts): full screen and layout focus are distinct actions. Tributary adds native Electron full screen, event-based state updates, visible exit controls, View-menu and command-palette access. Browser builds use the browser Fullscreen API when supported; embedded hosts retain their own window controls.
- Tributary uses Ctrl/Cmd+Shift+Enter for workspace focus and Ctrl/Cmd+Alt+Enter for full screen. These are configurable, avoid the debugger's F11 Step into binding, and appear in tooltips and menus. Escape dismisses an open menu/dialog first, then restores workspace focus, then exits full screen.
- Editor glyphs for breakpoints and diagnostics now precede line numbers. Source, numbers and gutter markers retain the same 22px row rhythm. Long-line source files offer explicit Format document and Wrap lines actions; formatting changes the draft, supports undo/redo, and never silently saves a file.

These are original adaptations of interaction patterns, not imported implementations or an embedded copy of either editor.

## Editor context menu

The editor now has a compact Radix right-click menu with grouped navigation, formatting, search, clipboard and file actions. Shift+F10 opens it from the keyboard. Right-clicking inside a selected range preserves that selection; clicking elsewhere moves the caret to that location. Read-only documents disable changes. Clipboard cut/paste validates that the document and selection have not changed while awaiting clipboard access.

Definition, type-definition, implementation and reference navigation use the configured trusted local language server through the [LSP language-feature requests](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#languageFeatures). Server responses are bounded, deduplicated and restricted to real files in the current project, including symlink checks. Multiple results have a keyboard-accessible location picker. Unsupported capabilities are reported as such. Rename/code actions, incoming/outgoing call hierarchy, remote permalinks and cross-project navigation are not implemented by this menu.

Validation: the full regression suite passed 343 checks. A final targeted run passed 14 language-tool, shortcut and QA-import checks, including navigation through a symlinked project root and rejection of external locations. TypeScript, the production UI build and whitespace checks passed. Isolated UI checks exercised context-menu copy/paste, selection preservation, draft formatting/undo, search/go-to-line, real fixture-LSP navigation, F12, native full-screen exit, and menu bounds at 320/390/768/900/1280/1920 pixels. The actual project window was separately verified at the physical display's 1920×1200 viewport without device emulation. VS Code host windows and macOS native window transitions were not visually tested in this environment.

## Sidebar and formatting follow-up

The workbench project sidebar closes on a primary pointer click outside it while allowing the clicked editor/chat/terminal control to receive the click. Its own project menus and dialogs remain usable, and the existing phone drawer keeps its modal behavior. Inline shortcuts appear on row hover or keyboard focus without moving labels.

Format on save is enabled by default and can be disabled in Settings → Language tools. Prettier takes priority for web languages so whitespace-only language-server formatting cannot leave compact `try/catch` blocks unchanged. The project-aware path below supersedes the initial bundled-only worker. Manual formatting remains in the editor right-click menu and uses the same undoable editor transaction. Failed formatting or edits made during formatting prevent the save; disk conflict checks remain in place. Unsupported files and files without an installed formatter save normally. Native formatting is skipped automatically in untrusted projects. No formatting runs merely from opening a file.

Local stdin/stdout adapters now include shfmt for Shell/Bash, StyLua for Lua/Luau, and Taplo for TOML, alongside gofmt, rustfmt, Ruff/Black, clang-format and Zig. Settings reports installation status and opens official setup guides; these tools are not bundled or installed silently. Adapter tests use fixture executables to verify arguments, input, failures and unchanged source files; actual system installations were not exercised for the three new tools.

References: [Prettier options](https://prettier.io/docs/options), [shfmt](https://github.com/mvdan/sh/blob/master/cmd/shfmt/shfmt.1.scd), [StyLua stdin](https://github.com/JohnnyMorganz/StyLua), [Taplo formatting](https://taplo.tamasfe.dev/cli/usage/formatting.html).

Validation for this follow-up: 25 focused formatter/workspace tests, TypeScript and production build passed. Isolated app checks covered row hover/focus, outside-click editor/chat dismissal, both rail and titlebar toggles, phone drawer behavior, actual Prettier worker output, undo/redo, automatic save formatting, the disable setting, right-click formatting, and failed formatting preserving the on-disk file.
