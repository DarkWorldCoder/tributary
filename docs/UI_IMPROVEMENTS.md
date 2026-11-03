# Interface improvements and included UI skills

Implemented 2 November 2026 in the local desktop and VS Code sources.

## What changed

- The desktop shell follows a familiar chat layout: New chat and Search chats in the sidebar, grouped project tools, a centered welcome view, a rounded composer and neutral dark surfaces. Chat responses keep assistant identity without timeline decoration. Planning and team actions sit in the composer’s + menu; permission mode stays visible. Long names truncate or wrap.
- Geist Variable is bundled as the default interface font. Appearance offers Geist, IBM Plex Sans or system fonts and response text sizes from 14–20 px. Code keeps its monospaced font; VS Code keeps its host typography.
- Settings has a visible entry, section search, consistent heading/help spacing, and keyboard focus return to the control that opened it. Theme and assistant choices use native toggle buttons with selected-state announcements.
- Skills has four included UI guides, readable titles, search, recoverable loading errors, and pagination for installed agent skills.
- Project rooms wrap their header controls at small widths, show people/projects in a collapsible panel, use singular/plural task counts, and use Radix AlertDialog for access removal and task release. Progress labels distinguish reported completion from verified execution.
- Files, Changes, Memory and Preview now live in a separate right-hand workspace while conversation stays visible. Expansion is optional. Changes groups the working tree and conversation activity; unified and side-by-side diffs include line numbers and file-status labels. Raw patch metadata is collapsed. The directory browser includes deep, empty, generated and optionally hidden files. File drafts survive tab changes and closing/reopening the workspace within the session.
- Memory defaults to readable notes. Edit/Save stay in the header, settings/history and recent activity collapse, and short sharing help appears on hover or keyboard focus. Conflicts and errors remain visible. The repeated assistant chips below the message box were removed; the composer’s picker still switches assistants.
- Assistant badge text chooses a contrasting color for standard six-digit brand colors. The terminal requests xterm’s minimum 4.5 contrast ratio.
- Onboarding no longer promises universal undo or file isolation. See [project-room scope](PROJECT_ROOMS.md) for actual capabilities.

## Using the included skills

Open **Settings → Skills → UI skills included with Tributary**, or **UI design skills** beneath a new project conversation. Choose:

| Skill | Purpose |
| --- | --- |
| Layout & typography | Text placement, reading width, spacing and responsive panels |
| Clear interface writing | Labels, instructions, empty states, errors and truthful status text |
| Choose UI components | Appropriate controls using the project’s existing primitives |
| Review usability | Real-screen, keyboard, readability and responsive checks |

**Use guidance** adds the full guide to an editable message. Add a specific task, review it, then send it to the selected assistant. From the task home, Tributary prepares a conversation first. It does not send a model request or change a project when guidance is selected. Normal assistant usage charges apply when a message is sent.

These are original, app-owned Markdown skills in `core/bundled-skills`, included by both packaging paths. They are loaded through a fixed allowlist, with a size limit. They do not depend on a particular assistant’s skill discovery or install anything into global user folders. Existing installed-skill sharing remains a separate action.

## Components and research

The app already uses shadcn components and Radix primitives. The selected direction extends those components, preserving the existing theme and keyboard/focus system:

- [shadcn Field](https://ui.shadcn.com/docs/components/radix/field): labels, descriptions and controls grouped together.
- [shadcn Empty](https://ui.shadcn.com/docs/components/radix/empty): structured empty states with a useful next action.
- [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility): semantics, focus management and keyboard behavior.
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines): an additional primary reference for interface review.
- [VS Code interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface): explorer/editor layout inspiration.

The external skills discovery CLI was unavailable in the offline package cache. Official source pages and locally installed UI guidance were inspected instead. No third-party skill pack was silently downloaded or represented as installed. A second UI primitive system was unnecessary for this pass.

## Validation

The full local suite passed **115 tests** before the model-picker addition, including shared-room concurrency/reconnect, folder containment, persisted tasks/documents, host integration and bundled UI guidance. After the final UI adjustments, TypeScript and production UI/extension builds passed, and focused packaged-skill/host checks passed. All four skill folders passed the skill creator’s frontmatter validator.

The actual Electron app was checked with an isolated profile, real temporary files and no paid model calls. The browser room was checked at 390 × 844. Checks covered full-width Markdown preview, hidden/empty folders, preserved unsaved drafts, deferred terminal opening, guidance insertion from project and task-home entry points, dialog cancellation, focus trapping/return and horizontal overflow. Final new-conversation and mobile-room automated accessibility scans found no violations. Modal focus guards and terminal-rendered ANSI text still produced automated “needs manual review” entries; this is not a product-wide accessibility certification.

Screenshots: [included skills](performance/ui-skills.png), [file preview](performance/folder-preview.png), [mobile project room](performance/project-room-mobile.png), [appearance](performance/typography-settings.png).

Editor, terminal and language-highlighting chunks now load when needed instead of all being loaded at startup. This pass verifies bundle separation, not a cold-start timing improvement. See [performance research](PERFORMANCE_ARCHITECTURE.md) for the broader native-bridge and profiling plan. No public server deployment, live shared-file editing, complete rich-document viewer or system-wide skill installation is claimed.

## Responsive layout and shortcuts

At 768–1199 px, opening the workspace collapses the left sidebar once to leave room for conversation and tools. Users can reopen it. Below 768 px the workspace uses the full screen and the background chat controls are hidden. Below 640 px, Files switches between a full-width folder browser and full-width reader using Browse files. Buttons and file rows have larger phone targets; all four tab labels fit at 320 px. The fixed pane respects device safe areas. Panel dragging now remembers the final width.

Keyboard shortcuts are available from the sidebar, More options, the + menu, command search, and Ctrl/Cmd + /. The searchable sheet uses platform-specific modifier labels. Ctrl/Cmd + Shift + O opens a new chat (Ctrl/Cmd + N remains), Ctrl/Cmd + K searches, Shift + Escape focuses the message, Ctrl/Cmd + B toggles the sidebar, Ctrl/Cmd + J toggles the workspace, and Ctrl/Cmd + Shift + E/D/M/P opens Files/Changes/Memory/Preview. Ctrl/Cmd + backtick toggles the terminal; Ctrl/Cmd + comma opens Settings. Editors, terminals, active dialogs, IME composition and handled shortcuts retain control of their keys. These are app-focused shortcuts, not system-wide bindings. Custom key rebinding is not included.

The actual desktop app was checked at 1280, 900, 640, 390 and 320 px with an isolated profile. Tablet chat input width increased from about 204 px to 314 px at 900 px with the workspace open. Keyboard navigation, search, sheet dismissal, file navigation and focusing the composer were exercised. Desktop welcome and phone memory accessibility scans found no violations. Dialog focus guards and clipped scroll content require manual review; this is not a full accessibility certification.

References: [ChatGPT desktop commands](https://learn.chatgpt.com/docs/app/commands), [ChatGPT sidebar search](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt). Screenshots: [desktop chat](performance/chat-desktop.png), [phone chat](performance/chat-phone.png), [tablet workspace](performance/workspace-tablet.png), [keyboard shortcuts](performance/keyboard-shortcuts.png).

## Model selection

The composer has separate assistant, model and permission controls. Model choices persist per assistant and model source in this app. Automatic preserves the native assistant or saved connection default. Codex discovery calls its installed app-server initialize/model-list metadata API, including additional models. Claude offers documented aliases and custom full IDs. OpenAI-compatible, Anthropic, Gemini, Ollama and LM Studio gateways can list models through their metadata endpoints. Lists do not prove account entitlement or compatibility. ACP and unconfigured custom integrations retain their own model settings.

Model discovery starts on demand; it does not send a prompt. Catalogs and processes are time/size bounded, response bodies and native stderr are not displayed as errors, and credentials stay in the backend. A custom model field handles services without a supported list. Selected models reach real native flags/direct request bodies, are retained on queued messages and retries, and are recorded as requested models on responses. Sessions are separated by model and gateway. This does not report a provider’s resolved model after aliasing/fallback. Team/Race dialogs still use their own agent defaults; dedicated per-role model/effort controls remain future work.

Sources: [Codex model/list](https://learn.chatgpt.com/docs/app-server#models), [Claude model configuration](https://code.claude.com/docs/en/model-config), [Gemini model metadata](https://ai.google.dev/api/models).

## Workspace tabs and coding layout — 3 November 2026

The latest reference changes the default **after a coding chat starts**: a 44 px activity rail, project explorer and editor on the left, and conversation on the right. The composer stays at the bottom of the chat. The initial welcome view and personal tasks keep their chat layout. **More options → Chat on left / Editor on left** switches arrangements without discarding file drafts. The reference-inspired dark surfaces and lighter icon strokes are scoped to the workbench; the VS Code extension retains its host theme.

The original chat-left arrangement remains available. Its workspace defaults to 56% of content width, capped at 640 px; the editor-first arrangement defaults to 70%. Both retain at least 360 px for desktop chat. Width preferences are stored separately, retaining the existing `panelWidth` preference. Below 768 px, the workspace fills the screen when opened; new phone conversations remain in chat until Files is opened. Below 640 px, Browse files switches between the browser and reader.

Workspace tools use one compact toolbar. Open documents have their own Radix tab list, followed by breadcrumbs and file actions. The Changes badge shows `99+` visually and retains the full number in its accessible label. Toolbars use 13 px text and 16 px icons; compact workbench file rows are 28 px, with 44 px phone controls. Scrollbars are thin, themed and higher contrast on hover/focus; forced-color and coarse-pointer modes keep native sizing. File tabs hide their scrollbar while retaining keyboard navigation, horizontal scrolling and the overflow menu.

Single-clicking replaces one italic preview tab. Double-click, Keep open or editing pins it. Dirty files cannot be replaced by previews. Closing a dirty file, closing others containing a dirty file, and reloading a dirty file require a Radix discard dialog. Close saved tabs skips drafts. Duplicate names include distinguishing parent folders; full paths remain available on hover. Close buttons are outside the tab list's ARIA ownership while remaining aligned with their files and keyboard accessible. The active tab stays visible through resizing and overflow.

The explorer defaults to 224 px with bounds of 176–360 px, a collapse action and the existing keyboard-accessible resize primitive. Open files, pinned state, drafts, active documents and expanded folders are retained separately for each visited project during the session. Hidden projects stop their live watches and reconcile disk changes when reopened. Clean files refresh; drafts keep their text and show a short disk-change notice. Failed reads retain the current file and offer Retry. Loading appears in the file icon and menu button, avoiding a row-height change during double-clicks. No database or backend API change was required; recovery after restarting the app remains outside this change.

A shared file-icon classifier covers code, JSON, Markdown, images, media, documents, spreadsheets, presentations, archives, configuration, databases, fonts, binaries and common special filenames. Icons are bundled SVG components, with a generic-file fallback. Folder loading and file reads retain visible loading indicators.

**Explain change** in the working-tree review inserts a read-only question containing the selected comparison. It preserves an existing message draft and sends nothing automatically. **Related activity in this chat** uses recorded file events to show the corresponding task and a link to the actual agent response; it does not invent attribution or reasons. Tools, Plan first, assistant/model selection, Skills and Team workflows remain connected to the existing execution paths. Tool execution depends on the integration: installed coding agents use their tools, while direct chat-only connections do not acquire a coding tool runtime from this interface change.

Validation used the actual Electron renderer, an isolated profile, temporary Git projects and explicitly labeled preview messages. No paid model request was sent. Checks cover both arrangements at **320, 390, 768, 900, 1280 and 1920 px**, preview replacement/pinning, double-clicks across twelve files, duplicates, dirty-close cancellation/confirmation, bulk close, keyboard navigation/resizing, project switching, save, read-error Retry and live disk updates. Switching layouts preserved unsaved edits. The full native regression suite passed **132 tests**; the seven focused tab/icon tests, TypeScript and production desktop/extension builds also passed. Automated accessibility results and viewport measurements are retained beside the screenshots; these checks are not a product-wide accessibility certification.

Evidence: [workbench desktop](performance/developer-workbench-1280.png), [phone workspace](performance/developer-workbench-390.png), [phone chat](performance/developer-workbench-320-chat.png), [workbench checks](performance/developer-workbench-validation.json), [original split-view checks](performance/workspace-tabs-validation.json).

The earlier LAN invitation, terminal-performance, command-parser, branch/project-control, notification-name, rich-preview and broader multi-agent-coordination requests remain separate follow-up work. This UI pass does not claim shared-file synchronization or universal provider tool support.

## Explorer and chat refinement — 3 November 2026

The explorer now starts with one compact project header. Search opens from its icon, focuses the input and closes with Escape, clearing the filter and returning focus to the trigger. The options menu contains Show hidden files, Refresh files and Collapse explorer. This removes the permanent search and hidden-files rows. Hidden-file visibility also applies to search results. Both choices remain local to the project's session. Desktop header actions fit the 176 px minimum explorer width; phone actions retain 44 px touch targets.

The chat header uses Search chats, Expand chat / Restore split view and More options. Desktop notifications move to the activity rail, while phone chat retains its notification control. Terminal remains in the rail and More menu. The existing resize handle lets people give chat more room. Expanded chat retains the open documents when the split is restored. Sidebar sections, active rows and folder icons share consistent spacing, border contrast and keyboard focus. Response font-size preferences remain respected.

File selection uses a quiet background instead of a bright edge. Open-file tabs have no individual borders or active underline, and focusing the editor does not draw a frame around the document. Keyboard navigation retains visible focus on tabs and file controls; the editor retains its caret and active line. Pane dividers remain for resizing.

Desktop scrollbars are 4 px high horizontally and 6 px wide vertically in Chromium; touch and forced-color modes retain native sizing. Coding-chat replies default to 13 px on desktop and at least 14 px on phones, with a separate persistent Coding chat text size setting. General response-size preferences remain unchanged. Appearance settings no longer show the font-help paragraph or decorative explanatory card.

File icons now distinguish React, Vue, Svelte and common programming languages, alongside package manifests, configuration, structured data, media, documents, archives, certificates, fonts, databases, 3D models and model/data assets. Language initials and bundled SVGs require no external icon service or font download. Unknown types retain a generic icon; icon support does not imply a new preview or editor for that format. The same classifier is used in explorer rows, file tabs, changes and file-mention suggestions. Source, UI, asset, test, documentation, configuration and dependency folders have matching folder icons.

Validation: **134 native regression tests passed**, including the expanded icon cases; TypeScript, production UI build and extension packaging passed. The actual isolated Electron app passed 25 UI checks, including explorer search, Escape/focus restoration, hidden-file toggling, refresh, collapse/restore, chat expansion/restoration, chat search, borderless selection, actual scrollbar dimensions and persisted chat-size changes. Layout checks at **320, 390, 768, 900, 1280 and 1920 px** found no page clipping and kept explorer actions visible, including at the 176 px minimum explorer width. Desktop and phone automated accessibility scans reported no violations; contrast items requiring manual review remain recorded in the accessibility JSON files. The local conversation fixture is explicitly labeled preview content; no model request was sent for these UI checks.

Evidence: [desktop workbench](performance/workspace-polished-1280.png), [expanded project sidebar](performance/workspace-polished-sidebar.png), [phone file browser](performance/workspace-polished-phone-browser.png), [phone chat](performance/workspace-polished-phone-chat.png), [interaction and viewport checks](performance/workspace-polish-validation.json).

## Shared controls, composer tools and team setup — 3 November 2026

File actions now live in a compact status bar **below the document**: Preview/Edit, Open in editor and Save. Breadcrumbs have their own 28 px navigation row; the open-file tabs remain above them. Save keeps its disabled/dirty state and keyboard shortcut. The workspace toggle moves beside the message box, with a fallback in More options. Chat's top bar focuses on the conversation, search and its menu; terminal and notifications retain activity-rail access.

Primary workspace rows share a 40 px desktop rhythm, 16 px icons, consistent content insets and aligned file labels/close buttons. Phone actions use 44 px targets. The model picker switches to an accessible icon in narrow composers, leaving room for workspace, agent, permissions and Send. Resizing controls no longer animates their dimensions. Sidebar rows show title, status and age; duplicate navigation and single-agent recipient captions were removed. Reply actions appear on hover or keyboard focus on desktop and stay visible for touch.

The composer's searchable **+** menu groups project files, skills, Plan first, teams, agents, assistant connections, configured MCP servers, memory, terminal and shortcuts. Lists load when their page opens. Choosing a project file inserts its reference into the draft; it is not a general file upload. Included skills insert their full guidance; installed skills are filtered for the selected agent. MCP choices prepare a request for the selected native agent's existing configuration or open settings. None of these actions automatically sends a prompt or adds tool capabilities to a chat-only connection. Existing drafts and focus are retained.

Team setup uses the same icon, typography and control sizes, with compact workflow choices, independent role selectors, selected-agent counts and optional checks. Phones show the selected workflow description once. Recorded history displays the available role, agent and step state; it does not imply that teammates share local files. The ongoing Manager workflow implementation is preserved.

Validation used the actual isolated Electron renderer at **320, 390, 768, 900, 1280 and 1920 px**. The recorded checks cover 57 alignment/menu interactions, 32 footer/composer checks and 17 team-configuration/keyboard checks. Footer Save wrote a temporary file, Ctrl+S restored its original content, Markdown switched between source and preview, and closing/reopening the workspace retained its pinned document. No model prompt was sent and no team was started. The 21 focused regression tests, TypeScript, production UI build and VS Code packaging passed.

Evidence: [current workspace](performance/workspace-controls-1280.png), [phone chat](performance/chat-controls-320.png), [alignment/menu checks](performance/alignment-composer-validation.json), [file actions and responsive composer](performance/file-footer-validation.json), [team setup checks](performance/team-composer-validation.json).

Final automated accessibility scans reported **zero violations** for the desktop workspace/composer, tools menu, team setup, phone workspace/footer, phone chat/composer and phone project-file menu. Decorative command dividers are hidden from the accessibility tree; unselected agent marks use readable neutral colors; full-screen workspaces expose a level-one heading. Automated incomplete items, including contrast checks requiring manual review, remain recorded in [accessibility results](performance/controls-accessibility-validation.json). This is scoped renderer evidence, not a product-wide certification.

## Images, editor controls and conversation context — 3 November 2026

Project images now have Fit, Actual size, zoom, dimensions and a full-screen viewer. Transparent images use a checkerboard; broken images have Retry. Complete raster previews are bounded at 16 MiB; text and SVG retain the existing 1 MiB limit. Oversized raster files return metadata rather than a truncated image. Project-relative Markdown images open the same viewer; HTTPS image links retain the external Open image action. This does not add a general attachment-upload service or previews for every binary format.

The editor footer shows the actual cursor position and line-ending details, with per-document line wrapping and Alt+Z. Wrapping preserves the document and undo history. File actions remain below the document. Desktop primary rows now use 36 px, with 32 px actions and a 200 px default explorer; this supersedes the previous pass's 40/224 px defaults. Workbench defaults give the editor 74% of available space while preserving minimum chat width and existing saved panel sizes. Phones retain 44 px controls.

The explicit Chat view uses the supplied conversation reference: a compact project sidebar, central chat, slim writing bar and optional project-context panel. Workbench remains available. The context panel shows actual project, branch, agent, recorded memory and configured MCP entries. Configured entries are not a tool-health or authentication guarantee. Smaller windows use a context drawer. Switching views preserves message drafts and unsaved files. All features in the searchable composer menu opens the existing command palette, including files/images, memory, preview, terminal, teams, connections, MCP and skills.

The final small-control pass standardizes selector padding, a 20 px label line, 16 px identity/action icons and 12 px chevrons. The agent badge remains visible when its label is hidden on phones. Zoom uses a compact minus/percentage/plus group. Control dimensions no longer animate during responsive resizing; hover and focus color transitions remain. Permission tooltips use short labels; explanations stay in their menu.

Validation: 30 focused regression tests passed; TypeScript, production UI build and extension packaging passed. The actual isolated Electron renderer passed 35 image/editor checks and 27 reference-layout checks at 320, 390, 768, 900, 1280 and 1920 px. Eight image/editor/feature-finder accessibility scans reported no violations; incomplete items remain recorded for manual review. No model request was sent and no team was started. Final selector/zoom and reference-context accessibility results are recorded separately below.

Evidence: [image/editor checks](performance/image-editor-validation.json), [reference-layout checks](performance/reference-chat-validation.json), [image/features accessibility](performance/image-features-accessibility.json), [small-control checks](performance/micro-alignment-validation.json), [reference-chat accessibility](performance/reference-chat-accessibility.json). [Research priorities](UX_RESEARCH_2026-11-03.md) distinguish future context/review receipts and per-agent capability checks from this implementation.

Final results: **53 small-control checks passed**, including measured centerlines within 0.5 CSS px, uniform icon sizing/padding, title/action separation, all six widths, menu Escape/focus return, image zoom and phone touch targets. Two resting-state accessibility scans passed for the updated phone selector/image surfaces; five additional reference Chat view/context/sidebar scans passed after transitions settled. Together with the eight image/editor/finder scans above, these are 15 scoped scans with no violations. Open-tooltip states are not a full accessibility certification; incomplete items remain available for manual review. The final isolated renderer had no console messages or uncaught errors. See [design comparison](../design-qa.md) and [console evidence](performance/ui-console-validation.json).
