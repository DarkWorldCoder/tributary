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

Search runs after a 300 ms pause in typing; Enter submits immediately. It searches saved text in the selected working folder, including hidden files. It retains the existing dependency/binary/link exclusions and bounds: 200 results, 20,000 visited entries, 1 MiB per file and 16 MiB read per scan. Include/exclude accept comma-separated glob patterns; brace groups retain their internal commas. This is not the complete VS Code ignore/glob implementation, workspace-wide replacement or unsaved-buffer search.

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


## Quick Input source alignment, 5 November 2026

Read the upstream source directly through GitHub's file API:

- [quickInput.css](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/media/quickInput.css), blob `4dcc37b522e3da3ace08111d46e64d2c3e2121ac`: 22 px row rhythm, 6 px list/header insets, compact key bindings and inline section labels.
- [quickInputController.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/quickInputController.ts), blob `bafd7f1a050998b63eba02bf9b3a746f68057bee`: width capped at 600 px or 62% of the viewport, result list height based on 40% of the viewport.
- [commandsQuickAccess.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts), blob `e05b71bd72c6c365ada6e0095b621c2f399a0b3b`: command provider integration and command-history action.

The desktop palette now uses those dimensions, square-edged compact inputs and rows, an editable `>` query, right-aligned shortcut badges, and inline recently-used/other-command labels. Quick Open uses the same geometry. Shared primitive radius/height classes no longer force important overrides over the feature's layout. Keyboard instructions remain available to screen readers without a persistent footer.

This adapts the MIT-licensed layout to Tributary's existing Radix/cmdk controls; it does not import the full VS Code runtime, advertise unsupported commands, or replace the existing search engine. The top offset remains below Tributary's title bar. Phones and coarse pointers retain 44 px targets rather than desktop density.

Verified in a disposable Linux Electron 44.7.2 profile with temporary files and no agent/provider invoked:

- Ctrl+Shift+P and F1 open the palette. `> memory` then Enter opens actual project memory. Reopening clears the query back to `>` and puts the executed command first in recent history.
- ArrowDown moves selection to the next command; Escape dismisses the palette.
- Ctrl+P, `helper`, Enter opens the actual `src/helper.ts` contents in the code editor.
- Desktop 1280×850: palette at x=340/y=40, width 600 px, rows 22 px; container radius 6 px and row/input radius 3 px.
- Narrow 375×812: x=16/y=40, width 343 px, rows 44 px, no document overflow.
- TypeScript, production UI build, and 23 focused shortcut/navigation/usability checks pass.

[Desktop](performance/quick-input-desktop.png) · [Narrow](performance/quick-input-narrow.png). Native Windows/macOS and installer distribution were not exercised. Unfinished file-tree memory work remains separate.

## Live search refinement, 5 November 2026

Rechecked the upstream sources above through GitHub's file API: `searchview.css`, `searchWidget.ts`, `findWidget.css`, `quickInput.css`, and `quickInputController.ts` retain the same blob hashes recorded here. In particular, `searchWidget.ts:658–690` implements delayed search on type; `quickInputController.ts:1010` uses 62% of the viewport capped at 600 px. Tributary retains that picker sizing and uses a fixed 300 ms debounce, rather than VS Code's configurable regex-dependent delay.

Search now updates while typing or changing filters, with one running request and only the latest waiting query. Obsolete responses and replies after close are ignored. Closing/hiding cancels queued work; an already running worker finishes under its existing limits. IME composition waits until committed. Enter bypasses the debounce without an extra repeat request. Down from the query focuses results; Up/Down, Home/End, Left/Right and Enter navigate, collapse and open exact file locations. The query/detail/result insets follow Search View's compact geometry; line numbers align in one column. Editor Find/Replace uses the bundled MIT-licensed VS Code Codicons with accessible button names and hover labels. Lingering background tooltips are hidden while a finder dialog owns focus, so they cannot cover its results on narrow screens.

The reproducible [Electron regression](../test/e2e/search-ui.cjs) passed ten grouped checks over actual temporary files/search workers, including deliberately delayed replies, composition, immediate Enter, filters, case/regex errors, keyboard/file-column navigation, close during a request, Find/Replace with exact undo, and Quick Open. The picker measures 600 px at 1280, 558 px at 900, 358 px at 390 and 288 px at 320; its top remains 40 px. The fixture reduces only its native minimum window width for phone renderer checks. TypeScript, UI build, VS Code bundle build and 37 focused native tests pass. The usability suite requires local networking and subprocess access; it passes with those permissions. No new installer, native Windows/macOS window, full VS Code runtime or live provider was tested.

Run after `npm run build:ui`: `node_modules/.bin/electron test/e2e/search-ui.cjs --no-sandbox --ozone-platform=x11` on Linux. `TRIBUTARY_SEARCH_OUTPUT` selects the JSON path; screenshots are saved alongside it. Results: [verification](performance/search-live-verification.json), [Search](performance/search-live-sidebar.png), [Find/Replace](performance/search-live-find.png), [top picker](performance/search-live-palette.png), [320 px picker](performance/search-live-palette-320.png).

## Matched-label refinement, 5 November 2026

Re-read Microsoft's current `quickInput.css`, `quickInputController.ts`, `searchview.css`, `findWidget.ts` and `findWidget.css` through the connected GitHub file reader. The controller still caps Quick Input at 600 px or 62% of the window; its CSS uses 22 px rows and 6 px horizontal insets. Those existing Tributary dimensions remain in place.

Added the missing matched-letter emphasis using these additional MIT-licensed sources:

- [filters.ts](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/filters.ts): contiguous-substring and subsequence range matching, adapted with iteration and original Unicode offsets.
- [highlightedLabel.ts](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/highlightedlabel/highlightedLabel.ts): render unmatched text and highlighted ranges separately, adapted to React text nodes.
- [quickInput.css](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/media/quickInput.css): bold matches with separate normal/selected theme colors.

Commands, agent names, chat titles/project names and Quick Open paths now emphasize matching letters. Quick Open matches are computed against the full relative path before clipping ranges to its separately displayed filename and directory. Labels retain the original text, including surrogate pairs and length-changing lowercase characters. Keyword-only results may have no emphasized label letters. Filtering/ranking still belongs to cmdk and the existing filename service; this does not claim to reproduce all VS Code fuzzy scoring. Imported themes supply `list.highlightForeground` and `quickInputList.focusHighlightForeground`; absent colors inherit the readable row foreground. The upstream MIT notice is preserved. Quick Open's one-result count now says “1 file”.

Validation of the final source: 24 focused tests (labels, Unicode, themes, shortcuts and navigation), TypeScript, production UI build and VS Code bundle build passed. The isolated Linux Electron regression passed 11 grouped checks over actual saved files/search workers, including match emphasis and the existing typing/race/composition/filter/regex/open/replace/undo/320–1280 px checks. Screenshots were visually inspected. No new installer or native macOS/Windows window was tested. Existing in-progress code-viewer work was present in the build but is excluded from this search change.

[Verification](performance/search-source-verification.json) · [Command match](performance/search-source-command.png) · [Filename match](performance/search-source-file.png).
