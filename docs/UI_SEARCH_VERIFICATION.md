# Command palette and file search

Implemented against the existing cmdk/Radix controls, using the [VS Code interface guide](https://code.visualstudio.com/docs/editing/getting-started/userinterface#_command-palette) as the interaction reference. The palette lists real Tributary actions; it does not advertise unsupported VS Code commands or extensions.

| Entry point | Behavior |
| --- | --- |
| Ctrl/Cmd + Shift + P, F1, title-bar search button | Top command palette with fuzzy search, shortcuts, categorized names and six recently used commands |
| Ctrl/Cmd + P | Top Quick Open dialog searches filenames in the current working folder, including hidden files |
| Ctrl/Cmd + Shift + F | Search sidebar with grouped, highlighted results and file filters |
| Ctrl/Cmd + F, Edit → Find in file | Search at the top of the focused code editor |
| Ctrl + H / Cmd + Option + F, Edit → Replace in file | Focus replacement text in the code editor |

Quick Open debounces filename queries, ignores obsolete responses, limits displayed results to 100, keeps the Explorer filter independent and opens selections as pinned tabs. Filename discovery retains the backend's existing dependency/output exclusions and traversal limits; this is not a promise to search every generated dependency file. Errors and loading state remain visible. File content is not stored in command history.

Earlier command-palette verification in a disposable Linux Electron 44.7.2 profile, with no installed provider invoked:

- Title-bar click, F1, Ctrl+Shift+P, command execution and persisted recent-command ordering.
- `> terminal` filtering; keyboard selection and Escape dismissal.
- Ctrl+P finds `src/welcome.ts`; Enter opens the actual file.
- Ctrl+Shift+F finds two `greeting` lines; a result opens the source file.
- Ctrl+F and the Edit-menu action open the top search panel; the menu restores editor focus.
- At 375×812, the palette is 343 px wide, 40 px from the top, with 44 px result rows and no horizontal document overflow.
- TypeScript and production build pass. Focused shortcuts/navigation/usability checks: 23 passed. The desktop transport regression run also passed all 534 checks with these UI changes present before the final minor close-target/history-scope/menu-error adjustments.

Windows/macOS native window behavior and packaged installer builds were not exercised for this change. The existing shortcut matcher separately tests Ctrl and Command behavior. This is a UI verification report, not an application-memory or startup-speed benchmark.


## Search sidebar and editor Find: open-source source review

Reviewed 5 November 2026 through GitHub's file API:

- [VS Code searchview.css](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/search/browser/media/searchview.css), Git blob `fafe257fcf6d539ae24771ff6bf9d95ca7bb583b`: compact input, query details, file groups and 22 px result rows.
- [VS Code searchWidget.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/search/browser/searchWidget.ts), Git blob `8c6b39875db86c97b3011ae341a0c050c50308e8`: query options and search widget structure.
- [VS Code findWidget.ts](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/find/browser/findWidget.ts), Git blob `03e1e16511b9f23cb8223d82948f97a2c0b64ea0`: 419 px initial width, count/navigation and separately expanded replacement.
- [VS Code findWidget.css](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/find/browser/findWidget.css), Git blob `62c6056c1d98d4b2765fe6b2c9a754cf693e6781`: floating editor placement and narrow layouts.

These MIT-licensed sources guide the layout. Tributary keeps its theme tokens, React controls and CodeMirror document/history engine. This is an adaptation of the search surfaces, not an embedded copy of the entire VS Code workbench.

Project search now replaces the Explorer sidebar. It supports case-sensitive, whole-word and regular-expression queries, include/exclude glob filters, per-file result counts/collapse, highlighted matches, and navigation to exact line/column. Both desktop and VS Code host adapters forward these options. Search results open text in the code editor, including Markdown. Ctrl/Cmd+Shift+E restores Explorer; opening Debugger replaces Search. Closing Search also restores Explorer.

Search is submitted with Enter. It searches saved text in the selected working folder, including hidden files. It retains the existing dependency/binary/link exclusions and bounds: 200 results, 20,000 visited entries, 1 MiB per file and 16 MiB read per scan. Include/exclude accept comma-separated glob patterns; brace groups retain their internal commas. This is not the complete VS Code ignore/glob implementation, workspace-wide replacement or unsaved-buffer search.

User regex scans run in a short-lived worker with a three-second parent deadline and are terminated on completion/failure/timeout. Ordinary literal queries use escaped expressions without launching that worker. Packaged worker dependencies are unpacked, and distribution verification now exercises a real regex search. This bounds a pathological search without changing the app's collector or claiming lower total RAM.

The editor has a floating top-right Find widget: case/word/regex controls, match count, previous/next, close, and expandable Replace/Replace All. Enter and Shift+Enter navigate, Escape closes, Ctrl+H / Cmd+Option+F opens Replace, and Ctrl/Cmd+Shift+P remains available while Find is focused. The count stops at 1,000 matches; navigation still uses the complete document. Replacements use the existing undo history.

[Native verification](performance/search-ui-verification.json) records:

- Four actual highlighted results across two files; regex and include-filter results also checked through the desktop UI.
- Clicking a result lands on line 5, column 17.
- Replace All changes three occurrences; one undo restores the exact original document.
- Invalid regex feedback, Find navigation and command palette from the Find input.
- At 375 px viewport width, the Find widget is 351 px wide, stays within the editor and has no overlapping navigation/close controls or page overflow.
- Real Electron ASAR worker execution succeeds; this is not a complete installer build.
- Full suite: 551 passed before the final host-forwarding/packaging/navigation adjustments. Final focused suite: 31 passed after those adjustments. TypeScript, production UI build and VS Code bundle build pass.

[Desktop screenshot](performance/search-ui-desktop.png) · [Narrow screenshot](performance/search-ui-narrow.png).

Windows/macOS native windows, older VS Code extension hosts and new installer releases were not exercised. Actual provider/model requests were not invoked. Temporary profiles and fixtures were isolated from user projects.
