# Split editors

Use **Ctrl+\** on Windows/Linux or **⌘+\** on Mac to split the current file to the right. The binding is listed in Keyboard shortcuts and can be customized. Each editor tab bar has a split button. Its menu, the command palette and tab right-click menu offer **Split right** and **Split down**.

Each group has independent tabs and a selected file. Click inside a group before opening a file from Explorer or Quick Open. Ctrl+Tab switches files in that group and restores keyboard focus there. Drag the divider, or focus it and use the arrow keys, to resize groups. The active group's selected tab has an accent edge.

The same file can appear in several groups. Text and unsaved drafts have one owner; edits, undo and disk updates reach the other views. Save/format/history actions belong to the group used. Closing one tab leaves other references open. Closing the last unsaved reference asks before discarding. **Close editor group** joins its tabs into a neighboring group and keeps their drafts. The folder's saved session restores group membership, direction, selected files and unsaved text.

Groups currently form a row or a column, with a layout toggle in the tab menu. Narrow workspaces display groups as rows. Arbitrary nested grids, tab dragging between groups and saved divider proportions are not implemented. Recovery accepts up to 16 groups and the existing 50-tab recovery limit; any unassigned recovered file remains available in the first group. Replaced previews are removed from group membership instead of retaining every filename visited.

## Source reference and validation

The interaction model was checked against Microsoft's MIT-licensed [editor commands](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorCommands.ts), blob `0cb56b5350645eb5194343d26aff8418732ccfab`: directional split commands, editor groups and group focus. This uses Tributary's existing React, Radix, CodeMirror and resizable panels; it does not embed a second editor runtime or add a package dependency.

The isolated Linux Electron check passes ten grouped checks with actual editor instances, temporary files and persisted drafts: split shortcut/focus, preservation of the existing editor instance, same-file synchronization and undo, correct-file save, group-specific Ctrl+Tab, Quick Open, keyboard resizing, rows, group joining, recovery, last-draft protection, narrow-window layout and native right-click splitting. Six focused test files, TypeScript, the production UI build and the VS Code bundle build also pass. Screenshots were visually inspected.

The existing [search regression](performance/editor-split-search-verification.json) also passes all 14 grouped checks against the final build, including exact line/column opening, Find/Replace with undo, keyboard navigation, query races, IME input, theme colors and 320–1280 px picker layouts.

The test fixture was corrected to use native keyboard activation for Radix menus/tabs and to distinguish closing one of several tab references from closing the last unsaved reference. No native Windows/macOS window, provider, installer or release build was verified. Separate local-engine changes were present in the source build and remain outside this change.

[Recorded checks](performance/editor-split-verification.json) · [Side by side](performance/editor-split-right.png) · [Rows](performance/editor-split-down.png) · [Narrow layout](performance/editor-split-narrow.png).
