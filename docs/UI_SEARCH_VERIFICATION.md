# Command palette and file search

Implemented against the existing cmdk/Radix controls, using the [VS Code interface guide](https://code.visualstudio.com/docs/editing/getting-started/userinterface#_command-palette) as the interaction reference. The palette lists real Tributary actions; it does not advertise unsupported VS Code commands or extensions.

| Entry point | Behavior |
| --- | --- |
| Ctrl/Cmd + Shift + P, F1, title-bar search button | Top command palette with fuzzy search, shortcuts, categorized names and six recently used commands |
| Ctrl/Cmd + P | Top Quick Open dialog searches filenames in the current working folder, including hidden files |
| Ctrl/Cmd + Shift + F | Top project-text search returns file, line, column and matching text |
| Ctrl/Cmd + F, Edit → Find in file | Search at the top of the focused code editor |
| Ctrl + H / Cmd + Option + F, Edit → Replace in file | Focus replacement text in the code editor |

Quick Open debounces filename queries, ignores obsolete responses, limits displayed results to 100, keeps the Explorer filter independent and opens selections as pinned tabs. Filename discovery retains the backend's existing dependency/output exclusions and traversal limits; this is not a promise to search every generated dependency file. Errors and loading state remain visible. File content is not stored in command history.

Verified in a disposable Linux Electron 44.7.2 profile, with no installed provider invoked:

- Title-bar click, F1, Ctrl+Shift+P, command execution and persisted recent-command ordering.
- `> terminal` filtering; keyboard selection and Escape dismissal.
- Ctrl+P finds `src/welcome.ts`; Enter opens the actual file.
- Ctrl+Shift+F finds two `greeting` lines; a result opens the source file.
- Ctrl+F and the Edit-menu action open the top search panel; the menu restores editor focus.
- At 375×812, the palette is 343 px wide, 40 px from the top, with 44 px result rows and no horizontal document overflow.
- TypeScript and production build pass. Focused shortcuts/navigation/usability checks: 23 passed. The desktop transport regression run also passed all 534 checks with these UI changes present before the final minor close-target/history-scope/menu-error adjustments.

Windows/macOS native window behavior and packaged installer builds were not exercised for this change. The existing shortcut matcher separately tests Ctrl and Command behavior. This is a UI verification report, not an application-memory or startup-speed benchmark.
