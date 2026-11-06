# Split editors

Use **Ctrl+\** on Windows/Linux or **⌘+\** on Mac to split the current file to the right. The binding is listed in Keyboard shortcuts and can be customized. Each editor tab bar has a split button. Its menu, the command palette and tab right-click menu offer **Split right** and **Split down**.

Each group has independent tabs and a selected file. Click inside a group before opening a file from Explorer or Quick Open. Ctrl+Tab switches files in that group and restores keyboard focus there. Drag the divider, or focus it and use the arrow keys, to resize groups. The active group's selected tab has an accent edge.

Use **Ctrl+1–8** (Mac: **⌘+1–8**) to focus a group by its visual position, or find **View: Focus Editor Group** in the command palette. Selecting the next group after the last one creates an empty pane. Skipping beyond that position does nothing. Quick Open and Explorer put the next file in the selected pane. Empty panes also survive restart. These shortcuts appear in Keyboard shortcuts and can be customized.

The same file can appear in several groups. Text and unsaved drafts have one owner; edits, undo and disk updates reach the other views. Save/format/history actions belong to the group used. Closing one tab leaves other references open. Closing the last unsaved reference asks before discarding. **Close editor group** joins its tabs into a neighboring group and keeps their drafts. The folder's saved session restores group membership, direction, selected files and unsaved text.

Right-click a tab and choose **Move into group**, or use the tab bar's **… → Move editor into group** submenu. Destinations show their visual group number and current file. The command palette also offers **View: Move Editor into Previous/Next Group**. These commands use existing neighbouring groups; at the outer edge they leave the file in place. A move selects and focuses the destination, pins the file, avoids duplicate tabs, and keeps the shared unsaved text. Moving an active editor into a newly mounted destination also transfers undo/redo, selection and scroll through a temporary value-only handoff; destination callbacks and language services are rebuilt. An already visible destination retains its own view state. Empty source groups remain available for another file and survive restart. Undo history is session-local; it is not saved to the draft store across app restart.

Groups currently form a row or a column, with a layout toggle in the tab menu. Narrow workspaces display groups as rows. Arbitrary nested grids, tab dragging between groups and saved divider proportions are not implemented. Recovery accepts up to 16 groups and the existing 50-tab recovery limit; any unassigned recovered file remains available in the first group. Replaced previews are removed from group membership instead of retaining every filename visited.

## Source reference and validation

The interaction model was checked against Microsoft's MIT-licensed [editor commands](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorCommands.ts), blob `0cb56b5350645eb5194343d26aff8418732ccfab`: directional split commands, editor groups and group focus. This uses Tributary's existing React, Radix, CodeMirror and resizable panels; it does not embed a second editor runtime or add a package dependency.

Numbered group behavior also follows `registerFocusEditorGroupAtIndexCommands` in that file: focus groups 2–8, create only the next missing group, and leave later positions alone. The first-group binding was checked in [editor actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorActions.ts), blob `2f6c4255df516cd993fe044f3d5005d47f45459c` (`FocusFirstGroupAction`).

The isolated Linux Electron check passes twelve grouped checks with actual editor instances, temporary files and persisted drafts: split shortcut/focus, preservation of the existing editor instance, same-file synchronization and undo, correct-file save, group-specific Ctrl+Tab, Quick Open, keyboard resizing, rows, group joining, recovery, last-draft protection, narrow-window layout, native right-click splitting, numbered group focus and command palette group focus. Six focused test files (36 tests), TypeScript, the production UI build and the VS Code bundle build also pass. Screenshots were visually inspected.

The existing [search regression](performance/editor-group-navigation-search.json) also passes all 14 grouped checks against the final build, including exact line/column opening, Find/Replace with undo, keyboard navigation, query races, IME input, theme colors and 320–1280 px picker layouts.

The test fixture was corrected to use native keyboard activation for Radix menus/tabs and to distinguish closing one of several tab references from closing the last unsaved reference. No native Windows/macOS window, provider, installer or release build was verified. Separate local-engine changes were present in the source build and remain outside this change.

[Recorded checks](performance/editor-split-verification.json) · [Side by side](performance/editor-split-right.png) · [Rows](performance/editor-split-down.png) · [Narrow layout](performance/editor-split-narrow.png).

[Numbered navigation checks](performance/editor-group-navigation-verification.json) · [Current three-group layout](performance/editor-group-navigation.png).

## Group move verification

The extended Linux Electron fixture passes 15 grouped checks, including native tab and toolbar submenus, moving an unsaved file into an empty pane, undo/redo after the move, saving the correct file, selecting an existing destination without duplicate tabs, and restoring group membership after reload. The original split, group focus, resizing, narrow layout and draft-protection checks also pass. Four focused test files pass 22 tests, including stale-transfer rejection and rebuilding editor extensions with the destination's owner. The full regression suite passes 600 tests; TypeScript and the production UI build pass. The desktop test caught a submenu close-focus race, now fixed by honoring the current destination group when the source menu closes.

The move interaction was checked against `moveCopyEditorsToGroup` and destination `focus()` in the same Microsoft source blob cited above. This is an adaptation to Tributary's existing editor, not a complete VS Code workbench implementation.

[Move checks](performance/editor-group-move-verification.json) · [Tab context menu](performance/editor-group-move-menu.png) · [Split panes](performance/editor-group-move-right.png).
