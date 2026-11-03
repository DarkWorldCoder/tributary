# Zed UI patterns for Tributary

Reviewed 3 November 2026. Audience: developers working with local coding agents. Scope: the major editor, explorer, chat, review, terminal and settings surfaces, with a near-term implementation order.

Zed is useful because controls stay close to the work: code in the center, tools in adjustable docks, and agent chats grouped by project. Tributary already has several of these foundations; the next work should improve placement, navigation and state retention.

## Evidence boundaries

- Reviewed Zed's current default-branch documentation, workspace dock source, theme density source and UI style modules. Reference revision: [8e8f54c](https://github.com/zed-industries/zed/commit/8e8f54c67edb1d0f4acaa0e9bc86cc9e36abe493). Default-branch documentation can describe behavior ahead of a stable release.
- Opened the official visual-customization page and [project-panel screenshot](https://images.zed.dev/docs/project-panel/panel.png). The screenshot illustrates the classic layout; it is not evidence of the newest native build.
- Inspected Tributary's existing workspace, editor, tree, chat, review, terminal and settings sources. Existing/Extend below means source support was found, not that every behavior was manually exercised.
- Recommendations and priorities are our inference for Tributary. Zed itself was not installed or benchmarked. This inventory covers major relevant UI patterns, not every setting or extension.

## Implemented first pass

Implemented and locally checked on 3 November 2026:

- Explicit Editor first, Chat first and Chat only presets; project-specific panel visibility, expansion and widths. Switching chats no longer clears expansion. Divider double-click or Enter restores the default width.
- Compact single-child folder chains, validated against directory contents; optional sticky folders; arrow keys, Home/End and type-to-select in the unfiltered explorer. Disk refreshes retain rows and scroll position.
- Recent open-file switching with Ctrl+Tab, keyboard cancellation and editor focus restoration.
- Structural document outlines for JavaScript/TypeScript, Python, Rust, Go and Markdown; document symbols for JSON, CSS-family and HTML files. These are current-document outlines, not project-wide semantic navigation.
- F8/Shift+F8 problem navigation with exact line/column targets; F7/Shift+F7 diff-hunk navigation in unified and split views.
- Opt-in Follow agent, paused by manual navigation or editing. Dirty documents remain protected. Individual queued messages can be edited or removed, and the composer has a compact Review action.
- Compact/comfortable desktop density, independent phone touch targets, and activity access in the chat toolbar. Phone overflow actions keep the title readable.

Layout choices persist locally; file drafts and open documents remain session-only. The broader dock system, split editors, semantic LSP navigation, inline file operations, word-level diffs and hunk staging remain follow-up work. This pass does not claim completion of all 54 patterns below.

Validation and screenshots: [Zed workbench verification](../performance/ZED_WORKBENCH.json).

## Original recommended order

1. Stabilize layout changes: opening files, receiving agent activity and switching chats must preserve the user's chosen view.
2. Use one panel-control pattern: move, collapse, expand and close in predictable locations.
3. Improve the compact explorer: keyboard navigation, folded directory chains and deliberate active-file reveal.
4. Add the recent-file switcher and next/previous problem actions.
5. Add opt-in Follow agent and a compact review bar near the composer.

These build on the current React/Electron app. Zed's Rust/GPUI UI components are implementation references, not drop-in React components. No Rust rewrite is needed for these UI improvements.

## Pattern inventory

The inventory records the original research baseline before this pass. **Existing** = keep and polish; **Extend** = partial equivalent existed; **New** = no equivalent was found in the inspected surface. **P0** = first pass; **P1** = next pass; **P2** = deeper infrastructure or follow-up. Implementation status is summarized above and in the companion JSON.

### Workbench

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z01 · Editor-first and agent-first presets | Extend | P0 | Preserve current layout choices; make transitions explicit and stable | [Reference](https://zed.dev/docs/windows-and-projects) |
| Z02 · Shared panel docks | Extend | P0 | Apply terminal-style positioning consistently to tools and chat | [Reference](https://zed.dev/docs/visual-customization) |
| Z03 · Per-project layout retention | Extend | P0 | Keep active document, widths and focus when switching chats | [Reference](https://zed.dev/docs/windows-and-projects) |
| Z04 · Panel zoom, close and focus actions | Existing | Keep | Use one control placement and accessible labels | [Reference](https://zed.dev/docs/visual-customization) |
| Z05 · Divider reset to configured width | New | P1 | Double-click and keyboard reset; retain resize bounds | [Reference](https://zed.dev/docs/ai/parallel-agents) |
| Z06 · Adjustable UI density | New | P0 | Compact desktop spacing with independent touch targets | [Reference](https://github.com/zed-industries/zed/blob/main/crates/theme/src/ui_density.rs) |
| Z07 · Separate UI, editor, chat and terminal fonts | Extend | P1 | Give each surface its own size without scaling every control | [Reference](https://zed.dev/docs/visual-customization) |
| Z08 · Shared spacing, typography and elevation | Extend | P0 | Extend current workbench tokens across menus and settings | [Reference](https://zed.dev/docs/visual-customization) |
| Z09 · Project, worktree and branch pickers | Extend | P0 | Show the active code location beside the title | [Reference](https://zed.dev/docs/windows-and-projects) |

### Explorer

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z10 · Preview and permanent file tabs | Existing | Keep | Retain single-click preview and edit/double-click pinning | [Reference](https://zed.dev/docs/project-panel) |
| Z11 · Auto-reveal active file | Extend | P0 | Reveal only on navigation; avoid scroll jumps on disk refresh | [Reference](https://zed.dev/docs/project-panel) |
| Z12 · Sticky ancestor folders | New | P1 | Keep current folder context visible in long trees | [Reference](https://zed.dev/docs/project-panel) |
| Z13 · Compact chains of single-child folders | New | P0 | Reduce deep indentation without hiding path context | [Reference](https://zed.dev/docs/project-panel) |
| Z14 · Full keyboard tree navigation | New | P0 | Arrow keys, Home/End, expand/collapse and type-to-select | [Reference](https://zed.dev/docs/project-panel) |
| Z15 · Inline create and rename | New | P1 | Keep filename edits beside the selected row | [Reference](https://zed.dev/docs/project-panel) |
| Z16 · Multi-select and compare two files | New | P1 | Support batch actions and a direct comparison entry point | [Reference](https://zed.dev/docs/project-panel) |
| Z17 · Move, copy, duplicate and recoverable trash | New | P2 | Add explicit file operations with undo where supported | [Reference](https://zed.dev/docs/project-panel) |
| Z18 · Git and diagnostic badges | New | P1 | Surface file state without adding separate navigation rows | [Reference](https://zed.dev/docs/diagnostics) |
| Z19 · Sorting and folder-scoped search | Extend | P1 | Keep filename filtering; add predictable sorting and text search | [Reference](https://zed.dev/docs/project-panel) |

### Tabs and navigation

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z20 · Recent-use file switcher | New | P0 | Ctrl+Tab picker for files; keep the existing chat switcher | [Reference](https://zed.dev/docs/tab-switcher) |
| Z21 · Pane splitting and tab movement | New | P1 | Open beside, move tabs and resize editor panes | [Reference](https://zed.dev/docs/visual-customization) |
| Z22 · Compact breadcrumbs and tab controls | Existing | Keep | Preserve the implemented alignment and dirty indicators | [Reference](https://zed.dev/docs/visual-customization) |
| Z23 · File-symbol outline | New | P1 | Explain functions, classes and sections beside the code | [Reference](https://zed.dev/docs/outline-panel) |
| Z24 · Definitions, references and project symbols | New | P2 | Add on-demand LSP support; do not fake symbol resolution | [Reference](https://zed.dev/docs/finding-navigating) |
| Z25 · Unified fuzzy command navigation | Extend | P1 | Rank recent commands and show the active shortcut | [Reference](https://zed.dev/docs/command-palette) |

### Problems and review

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z26 · Live inline diagnostics | Extend | P1 | JSON/CSS-family now work; add more language adapters incrementally | [Reference](https://zed.dev/docs/diagnostics) |
| Z27 · Next and previous diagnostic | New | P0 | One keyboard action to inspect the next problem | [Reference](https://zed.dev/docs/diagnostics) |
| Z28 · Optional inline error lens | New | P1 | Show concise messages beside code only when requested | [Reference](https://zed.dev/docs/diagnostics) |
| Z29 · Scrollbar error and search markers | New | P1 | Add location hints without widening the editor | [Reference](https://zed.dev/docs/diagnostics) |
| Z30 · Unified and split diffs | Existing | Keep | Preserve existing diff modes and line wrapping | [Reference](https://zed.dev/docs/git) |
| Z31 · Word-level change highlighting | New | P1 | Make small edits easier to identify | [Reference](https://zed.dev/docs/git) |
| Z32 · Hunk-level stage and review actions | New | P1 | Keep/reject or stage individual changes with clear scope | [Reference](https://zed.dev/docs/git) |
| Z33 · File history | New | P2 | Trace a file's changes from its tab or tree entry | [Reference](https://zed.dev/docs/git) |
| Z34 · Changed-files tree and flat views | Extend | P1 | Let developers group larger change sets by folder | [Reference](https://zed.dev/docs/git) |

### Agent UI

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z35 · Project-grouped independent chats | Existing | Keep | Retain background execution and visible agent identity | [Reference](https://zed.dev/docs/ai/parallel-agents) |
| Z36 · Fast recent-chat switcher | Existing | Keep | Retain search and status in the right-side chat header | [Reference](https://zed.dev/docs/ai/parallel-agents) |
| Z37 · Searchable archived history and restore | Extend | P1 | Distinguish recent chats from archived work | [Reference](https://zed.dev/docs/ai/parallel-agents) |
| Z38 · Editable individual queued messages | Extend | P1 | Existing queue needs per-message edit/remove controls | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z39 · Optional Follow agent mode | New | P0 | Follow reads/edits only after opt-in; manual navigation pauses it | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z40 · Persistent compact change-review bar | Extend | P0 | Keep changed-file count and Review beside the composer | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z41 · Rich context chips | Extend | P1 | Extend file mentions to selections, diagnostics and other chats | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z42 · Inspectable compaction summary | New | P1 | Show what was retained when context is shortened | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z43 · Expandable message editor | New | P1 | Expand long prompts without permanently enlarging the sidebar | [Reference](https://zed.dev/docs/ai/agent-panel) |
| Z44 · Agent capability boundaries | Extend | P0 | Surface existing capability metadata near unavailable actions | [Reference](https://zed.dev/docs/ai/external-agents) |

### Terminal and tasks

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z45 · Terminal positioning | Existing | Keep | Retain left/right/top/bottom docking already implemented | [Reference](https://zed.dev/docs/terminal) |
| Z46 · Terminal as a regular editor tab | New | P1 | Offer a center workspace terminal for long sessions | [Reference](https://zed.dev/docs/terminal) |
| Z47 · Split terminal sessions | New | P1 | Show parallel command output without switching tabs | [Reference](https://zed.dev/docs/terminal) |
| Z48 · Terminal search and clickable paths | Existing | Keep | Retain current search addon and file-link handling | [Reference](https://zed.dev/docs/terminal) |
| Z49 · Task picker and rerun history | Extend | P1 | Build on project checks and project run commands | [Reference](https://zed.dev/docs/tasks) |
| Z50 · Task reveal and terminal reuse controls | New | P1 | Allow background tasks without stealing editor focus | [Reference](https://zed.dev/docs/tasks) |

### Settings

| Pattern | Tributary | Order | Product change | Zed source |
| --- | --- | --- | --- | --- |
| Z51 · Searchable settings controls | Existing | Keep | Improve field matching while retaining the section selector | [Reference](https://zed.dev/docs/configuring-zed) |
| Z52 · Project-specific editor overrides | New | P2 | Keep per-project language behavior separate from global appearance | [Reference](https://zed.dev/docs/configuring-zed) |
| Z53 · Live icon-theme preview | New | P2 | Extend current file icons through a stable mapping API | [Reference](https://zed.dev/docs/icon-themes) |
| Z54 · Visible shortcut hints | Extend | P0 | Use existing Mac/Windows/Linux bindings in menus and tooltips | [Reference](https://zed.dev/docs/command-palette) |

## Proposed placements in Tributary

| Surface | Placement |
| --- | --- |
| Top bar | Project/worktree/branch, navigation, global commands |
| File explorer | One compact header; search on demand; tree operations on the selected row |
| Editor | File tabs, breadcrumbs, code; file-specific actions at the document edge |
| Bottom tools | Problems, Output and task results; terminal may also use a side dock or editor tab |
| Chat header | Chat switcher, agent identity, Follow and close |
| Composer | Context, model/permissions, queued messages and compact Review summary |
| Settings | Searchable controls; appearance, shortcuts, tools and project behavior grouped separately |

This placement is a proposed Tributary design, not a description of a single Zed screenshot. Preserve the user's layout and expose presets through explicit actions.

## UX lessons from public reports

These are issue reports, not independently reproduced failures or population-frequency measurements. Counts were observed on 3 November 2026.

| Risk | Public signal | Severity for Tributary | Confidence and product move |
| --- | --- | --- | --- |
| Session state disappears | [#15959](https://github.com/zed-industries/zed/issues/15959), an older Wayland report still open, with 17 comments | High if drafts or layout are lost | Medium: reported environment-specific behavior. Test restore and project switching separately; preserve drafts before changing views. |
| Project actions are inconsistent | [#66392](https://github.com/zed-industries/zed/issues/66392), recent sidebar-removal report; 3 comments | Medium | Medium: one recent report. Menu actions and command-palette actions should use the same handler. |
| Multi-root and separate projects are confused | [#66280](https://github.com/zed-industries/zed/issues/66280), Windows CLI/UI difference; 4 comments | Medium | Medium: one report. Offer explicit Add folder to this project versus Open another project choices. |
| Existing workspace files cannot be brought over | [#9459](https://github.com/zed-industries/zed/issues/9459), VS Code workspace-import request; 442 total reactions and 51 comments | Medium for migration | High that the request exists; reactions do not establish overall prevalence. Consider an import preview for roots/settings, with unsupported settings listed. |

## Implementation map

| Work | Tributary entry points |
| --- | --- |
| Layout and dock retention | `ui/src/App.tsx`, `ui/src/components/workspace-panel.tsx`, `ui/src/components/terminal-panel.tsx`, `ui/src/store.tsx` |
| Explorer and file switching | `ui/src/components/directory-tree.tsx`, `ui/src/components/workspace-files.tsx` |
| Consistent sizing and icons | `ui/src/index.css`, `ui/src/components/file-type-icon.tsx`, existing UI primitives |
| Follow, queues and review bar | `ui/src/components/conversation.tsx`, `composer.tsx`, `thread-header.tsx`, activity events |
| Diagnostics and next problem | `ui/src/components/code-editor.tsx`, `project-checks.tsx` |
| Fine-grained diffs | `ui/src/components/file-diff.tsx`, `review-panel.tsx`, scoped backend Git actions |

## Verification for the next UI pass

- Switch projects/chats, open a file from Problems, receive disk updates, and start a background task without involuntary view changes.
- Check 320, 390, 768, 900, 1280 and 1920 px; keep desktop density separate from touch target size.
- Exercise keyboard-only tree navigation, recent-file switching, dock focus and Escape/close behavior.
- Dirty files remain pinned and protected. Follow mode cannot discard a draft or override manual navigation.
- Stage/reject actions show their scope and verify the current file revision before applying a hunk.

## Source map

Primary evidence: Zed's official docs for layout, project panel, tab switcher, navigation, outline, diagnostics, Git, agent panel, parallel/external agents, terminal, tasks, settings and icons, linked beside each pattern.

Source implementation references: [dock.rs](https://github.com/zed-industries/zed/blob/main/crates/workspace/src/dock.rs), [UI styles](https://github.com/zed-industries/zed/blob/main/crates/ui/src/styles.rs), and [density](https://github.com/zed-industries/zed/blob/main/crates/theme/src/ui_density.rs). Density is marked experimental in Zed's source; treat it as a design concept rather than a fully standardized behavior.

Public feedback: five open workspace issues were inspected; the table highlights four relevant signals. Reddit, X, private telemetry and usability interviews were not sampled, so no frequency or satisfaction claims are made.

The implemented subset is recorded at the top of this document; remaining inventory items are recommendations. The earlier live JSON/CSS checks, completions and additional linter adapters are documented separately; see [Project checks](../PROJECT_CHECKS.md) and [verification](../performance/LANGUAGE_ASSISTANCE.json).
