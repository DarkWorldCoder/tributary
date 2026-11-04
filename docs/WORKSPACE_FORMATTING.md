# Workspace folders and formatting

## Multiple folders

- **File → Add folders to workspace…** selects several local folders. The project-name menu provides the same action.
- All roots appear in the file explorer. Roots expand independently. Opening a file chooses its root; the folder selector also switches roots.
- Each root keeps its own tabs, draft recovery, file watches and editor history. Same-name files in different roots remain distinct.
- Added folders are available to coding agents through their existing extra-directory arguments.
- **Manage folders** removes a root from the workspace without deleting its files.
- **Open workspace…** reads local `.code-workspace` folder lists, including JSON comments, trailing commas, relative paths and local file URIs.
- **Save workspace as…** writes portable relative paths where possible. Updating an existing workspace preserves comments, root aliases, unrelated settings and existing absolute/URI folder paths. An identical folder list causes no rewrite.
- Opening a workspace imports its folder list; it does not execute or apply the workspace file's task, extension or settings entries. Remote workspace URIs are not supported in this slice.

## Existing formatting

Format document, right-click formatting and Format on Save share the project-aware formatter.

1. Use the project's installed Prettier runtime when one is present inside the selected root; otherwise use bundled Prettier 3.9.10.
2. Resolve project Prettier config, overrides and EditorConfig. Trusted projects can load their config modules and installed plugins in a separate process with bounded input/output and a timeout. No packages are installed by formatting.
3. Without a Prettier config, infer common indentation, quote, semicolon and trailing-comma preferences from the existing on-disk file. Preserve its line endings unless project rules override them. This is a conservative fallback, not an exact recreation of arbitrary hand formatting.
4. Native formatters continue to handle their own languages and project config. Unsupported or unavailable formatters do not block an ordinary automatic save.

No formatting happens just from opening a file. Identical file contents are not rewritten, so modification times stay unchanged. Consistent rules and formatter versions reduce formatting-only diffs; they cannot guarantee conflict-free Git merges.

## Format all files

Open **Files → Open files menu (…) → Format all files…**. The operation applies to the folder shown in the dialog, including its subdirectories. Choose another workspace root to format that folder separately.

- Preview changes first, select files, and review red/green diffs.
- Git-ignored, Prettier-ignored, generated, binary, oversized and non-UTF-8 files are skipped. Unsaved files in the current root are excluded.
- A preview scans at most 400 eligible files / 8 MB. The dialog explicitly reports limits and unavailable formatters.
- Apply checks source contents again and keeps newer disk edits or unsaved drafts. Known config changes require another scan.
- **Undo formatting** restores only files still matching the applied output. It preserves newer work.
- Previews expire after 10 minutes and are held in memory, with at most two project previews retained.

## Source patterns and validation

The workspace behavior was implemented against Tributary's existing hub and React editor. It follows the normalized/deduplicated folder identity and portable workspace-file editing patterns in [VS Code's workspace editing service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workspaces/browser/abstractWorkspaceEditingService.ts) and [workspace serialization helpers](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/common/workspaces.ts). It does not embed VS Code's complete workbench or extension host.

Formatting uses the [Prettier API](https://prettier.io/docs/api), including project config resolution, EditorConfig and ignore-file checks. The packaged desktop helper and VS Code extension include the runtime dependencies.

Evidence: the full regression suite passed 352 tests before the final fallback refinement. A final focused run passed 20 tests and additionally checks the packaged formatter outside the source checkout, workspace serialization and style preservation. Isolated Electron UI checks cover multi-root browsing, same-name files, draft retention, root-specific save/review, add/remove-folder controls, persistence after reload, format previews/apply/undo, newer background edits, and dialog bounds at 320/390/768/1280 pixels. Native folder/open/save dialogs, native macOS/Windows windows, and a released Electron archive were not exercised visually.

## Folder removal and change review

- Right-click an added root, or use its `…` menu, then **Remove folder from workspace**. Files remain on disk and editor drafts are kept. **Undo** stays in the workspace until dismissed. The main project uses **Close workspace**, which keeps its project and chats available.
- In the Files explorer, switch to **Changes** for the selected folder's Git branch, changed-file list, status badges and available added/removed line counts. Untracked files without known counts do not show invented zeroes.
- Select a changed file to compare it inside the workspace, using unified or side-by-side layout. Deleted files can be reviewed without trying to open a missing file. **Edit file** returns to the editor; unsaved drafts are kept and are explicitly excluded from the saved Git comparison.
- Right-click an individual file and choose **View file changes**, or use **Review saved file changes** in the editor. Comparisons refresh while visible, including edits whose line counts do not change. Additional roots use their own Git repository and paths.
