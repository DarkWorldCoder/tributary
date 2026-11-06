# Feature status and next work

Memory follow-up on 6 November: [complete editor diff metadata](performance/EDITOR_DIFF.md) removes review-only row/column allocations and fixes missing gutter changes after 2,000 preview rows. Sixty isolated parser subprocesses keep equal-output performance comparisons separate from expanded marker coverage. Validation: 647 regressions and five native Linux checks. Overall memory/literature/OS/model coverage remains ongoing.

6 November update: [project editor settings and ESLint](PROJECT_ESLINT.md) now provide local-tool setup, real live diagnostics, undoable fixes and separate fix-on-save. Files use bounded asynchronous reads; nested packages select their own Prettier runtime/plugins. The publisher verifies uploaded SHA-256 digests before publication and completed retries. Validation: 642 regression tests, 10 real-ESLint Linux editor checks, 5 formatting checks, 17 split-editor checks, and a local packaged Linux runtime probe. Cross-platform packaged checks run in Distribution; these checks are not installer GUI certification or a refreshed performance comparison.

Source-reviewed on 2 November 2026. This tracks every candidate in PRODUCT_ROADMAP.md, not a claim that the whole roadmap is delivered. “Implemented” describes the stated foundation; “Partial” lists the remaining boundary. “Not built in” means no dedicated implementation was identified in this pass; a capable installed assistant may offer related functionality independently.

New in this pass: revision-checked memory editing/history, opt-in bounded memory context, strict handoff limits, team validation and persisted step records, unified connector diagnostics, live local file views with polling fallback, and optional direct HTTPS room hosting. Setup and evidence are in [COORDINATION_AND_MEMORY.md](COORDINATION_AND_MEMORY.md) and [PROJECT_ROOMS.md](PROJECT_ROOMS.md).

Implemented on 3 November: the [Tests evidence workspace](QA_RESULTS.md) imports Playwright JSON reports, preserves attempts and non-passing outcomes, retains screenshots/traces and creates Markdown bug reports. Workspace focus and native desktop full screen now have separate controls and restore actions. This does not deliver the remaining autonomous QA roadmap.

The largest outstanding engineering work is shared source-file synchronization and conflict resolution, durable isolated task worktrees with integration checks, account-based connector authorization, rich document import/export, complete memory lifecycle controls, and release hardening. None is implied complete by the new coordination records.

| ID | Roadmap capability | Status | Evidence or remaining work |
| --- | --- | --- | --- |
| G01 | Built-in assistant connection: do useful work without installing coding software | Implemented foundation | Direct text connection to a compatible service; requires a running local model or provider account. |
| G02 | Guided connection setup: explain account, data destination, limits, and a harmless connection test | Partial | Guided endpoint/key/model setup and an explicit, potentially billable connection test; account OAuth remains. |
| G03 | Installers with tested OS support, clear updates, and a recoverable failed update | Partial | Packaging configuration exists; release/update and cross-platform certification remain. |
| G04 | Clearly labeled example workspace with a useful sample outcome and no surprise charges | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| G05 | Optional goal-based starter suggestions, with a visible skip action | Partial | Suggested project prompts and task choices; no adaptive onboarding. |
| G06 | In-app help and actionable setup errors, including a masked diagnostic report | Partial | Actionable errors and connector diagnostics; no support-report export. |
| W01 | Outcome-based home screen: write, understand, compare, organize, or ask freely | Implemented foundation | Task home offers Write, Understand, Learn and Organize. |
| W02 | Personal workspaces holding related tasks, materials, and outputs without requiring Git | Implemented foundation | Personal workspace persists conversations, supplied text and documents without Git. |
| W03 | Guided task templates that collect only the inputs necessary for the chosen result | Implemented foundation | Ten input-guided task templates. |
| W04 | Recent work and “Continue where I left off”, with a concise progress summary | Partial | Recent conversations and statuses; no dedicated progress-summary screen. |
| W05 | Search, rename, pin, archive, duplicate, and organize work with familiar controls | Partial | Conversation search, rename and deletion exist; full pin/archive/duplicate organization remains. |
| W06 | Optional advanced controls for developers while preserving the everyday workflow | Partial | Everyday task entry and advanced tools coexist; no complete simplified-mode preference. |
| D01 | Drag-and-drop PDF, DOCX, Markdown, and text with extraction status and limits | Partial | Text and Markdown attachments only; PDF/DOCX extraction remains. |
| D02 | Images and scanned-document text extraction, with page references and quality warnings | Partial | Composer image picker/paste/drop, thumbnail and zoom previews, and supported-agent image transport are implemented. OCR, page references and quality warnings remain. |
| D03 | CSV/XLSX import with worksheet selection, type preview, and original-file preservation | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| D04 | Audio upload or explicit recording with a reviewable transcript | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| D05 | Choose files or folders, see exactly what is accessible, and search permitted contents | Partial | Paged folder tree, file reads and bounded filename search; no full content index. |
| D06 | Web links and a source library showing origin, retrieval time, and inaccessible content | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| U01 | Writing assistant: draft, shorten, rewrite, translate, and adjust tone | Partial | Writing/translation templates and direct text responses; quality depends on the assistant. |
| U02 | Document questions and summaries linked to the supplied evidence | Partial | Questions and summaries from supplied text; no page-linked evidence engine. |
| U03 | Document comparison: differences, common points, missing information, and a recommendation draft | Partial | Labeled text comparison template; no structured document diff engine. |
| U04 | Study help: explanations, study guides, flashcards, and practice questions from chosen sources | Partial | Explain and study-guide templates; no flashcard/test artifact. |
| U05 | Research briefs with source links, dates, and clear distinction between facts and inference | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| U06 | Spreadsheet cleanup and analysis with a proposed transformation and verified calculations | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| U07 | Proposals, briefs, meeting notes, and action-item drafts using editable templates | Partial | Draft documents and notes; richer reusable proposal templates remain. |
| U08 | Personal plans, schedules, checklists, and simple budget organization from user-supplied details | Partial | Plan/checklist drafting from text; no structured schedule or budget engine. |
| O01 | Editable document panel beside the conversation, with changes saved independently of chat | Implemented foundation | Editable document panel with independent persistence. |
| O02 | Tables and charts first; slide and visual drafts later when rendering/export is dependable | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| O03 | Verified PDF/DOCX/Markdown export first; CSV/XLSX and slide exports as those artifact types ship | Partial | Markdown/text export; PDF, Office and slide exports remain. |
| O04 | Named versions, before/after comparison, and restoring a prior output | Partial | Document revision history; named comparison UI remains. |
| O05 | Clear copy, download, print, and “open containing folder” actions where supported | Partial | Copy and supported exports; unified print/reveal workflow remains. |
| O06 | Completion checklist showing delivered files, unsupported requests, and remaining user decisions | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| C01 | A short understandable plan for multi-step actions, with the option to adjust scope | Partial | Plan mode and reviewable prompts; no universal action-plan contract. |
| C02 | Task-specific read/create/change permissions listing actual folders and connected tools | Partial | Agent access modes and scoped ACP file access; direct text has no tools. |
| C03 | Review the exact recipients, content, destination, and cost before an external action is approved | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| C04 | Stage proposed file edits and keep recoverable copies for non-Git workspaces | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| C05 | Stop, cancel, and resume where safe, with completed and partial work clearly identified | Partial | Stop/cancel and retained partial replies; safe task-level resume remains. |
| C06 | Change history and honest undo boundaries; no implied recall of an already-sent message | Partial | Git checkpoints, document versions and memory versions; no universal undo. |
| M01 | Separate personal preferences, workspace knowledge, and temporary task state | Partial | Project notes, task messages and bounded context; personal semantic scopes remain. |
| M02 | Saved-knowledge screen with view, edit, pin, forget, history, and source information | Partial | Edit, search, source-line context and 20 app-written versions; pinning and item-level forget remain. |
| M03 | “Remember this” and “Use only for this task”, with a visible storage scope | Partial | Explicit project notes and opt-in prompt excerpts; temporary task messages remain in history. |
| M04 | Session summaries that preserve goals, decisions, current output, and pending work across assistants | Partial | Bounded deterministic handoff preserving initial and recent context; no semantic compaction. |
| M05 | Expiration and stale-source detection; sensitive details excluded from durable personal memory by default | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| M06 | Memory export and deletion that covers derived summaries, indexes, and cached context | Partial | Notes are editable files; comprehensive deletion of past prompts, backups and derived context remains. |
| A01 | Automatic task routing within the user's chosen providers, capabilities, permissions, and budget | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| A02 | Simple speed/detail preferences with provider/model details available on demand | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| A03 | Optional second opinion or review that states additional provider use and estimated cost | Partial | Read-only council and build/review workflows; no price estimate. |
| A04 | Switch assistant while keeping the same materials, current output, and useful task summary | Implemented foundation | Assistant switching with bounded handoff context. |
| A05 | Quota and failure recovery; ask before a fallback changes data destination, price, or permissions | Partial | Explicit errors and partial responses; no transparent fallback to a different provider. |
| A06 | Capability checks: disable unsupported files/tools rather than imply every assistant can handle them | Partial | Builder role rejects text-only assistants; diagnostics explain text/MCP limits. |
| I01 | Google Drive/OneDrive file access with source-level permissions, starting with read access | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| I02 | Gmail/Outlook drafts and thread summaries; sending is a separate reviewed action | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| I03 | Calendar reading and proposed events; invitations require reviewed details and permission | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| I04 | Notion/Slack knowledge lookup with citations, permission checks, and disconnect controls | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| I05 | Browser-assisted tasks with visible steps, scoped access, and paused consequential submissions | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| I06 | Portable workspace export/import with sources, outputs, and a preview of included personal data | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R01 | Save a successful task as a reusable recipe with clearly editable inputs | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R02 | Preview each recipe run's files, actions, and cost; grants remain tied to scope | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R03 | Scheduled tasks that show the next run, last result, and whether the computer must remain awake | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R04 | Source-change triggers with deduplication, stop controls, and notifications for meaningful changes | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R05 | Batch processing with preview samples, per-item status, retry, and partial-success reporting | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| R06 | A simple recipe builder assembled from tested steps, after templates prove demand | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| X01 | Full keyboard operation, visible focus, screen-reader labels, and meaningful status announcements | Partial | Accessible primitives and repaired workspace tabs; not a complete accessibility certification. |
| X02 | Readable type, zoom, sufficient contrast, reduced motion, and comfortable result layouts | Partial | Bundled fonts, reading-size controls and contrast fixes; not all views audited. |
| X03 | Localized interface and help, translation-ready content, and right-to-left layout support | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| X04 | Optional voice input and read-aloud, with explicit recording state and a complete text alternative | Not built in | Remains in the roadmap; no dedicated end-to-end implementation verified. |
| X05 | Small-window layouts first; a secure mobile/web companion when sync and identity are ready | Partial | Small-window UI and responsive room page; no mobile workspace sync. |
| X06 | Examples, plain-language errors, accessible support, and context-preserving retry actions | Partial | Clearer labels/errors and preserved drafts; broader onboarding/support remains. |
| T01 | Shared workspaces with deliberate invitations and clear ownership | Partial | Invited project rooms share tasks and progress; source files remain separate. |
| T02 | Viewer/editor/admin permissions that protect personal memories and restricted sources | Partial | Owner/member room boundaries; no full viewer/editor/admin matrix or source permissions. |
| T03 | Comments, requested revisions, approval assignments, and human task handoff | Partial | Task claims, dependencies, progress notes and review status; no inline comments or approval assignments. |
| T04 | Shared team templates and approved workspace instructions | Partial | Local shared project instructions and included skills; no shared server template library. |
| T05 | Workspace usage limits and an activity record of who did what | Partial | Durable room events and team-run history; no workspace spend quotas. |
| T06 | Restricted sharing links with expiration, revocation, and a preview of what recipients see | Partial | Revocable access keys; no expiration or public share-link workflow. |
| Q01 | Autosave and crash recovery with clear saved, saving, failed, and recoverable states | Partial | Persisted replies/documents and memory revisions. The message being typed, open file tabs and unsaved file text survive a crash or restart (`core/drafts.js`, private, 30-day expiry); a file changed on disk meanwhile is compared, not overwritten. Queued messages and attachments are not yet recovered. |
| Q02 | Plain-language diagnostics with secrets removed and user-controlled report sharing | Partial | Redacted connector configuration report; no complete support bundle. |
| Q03 | Usage estimates, available provider-reported actuals, hard execution limits, and budget notifications | Partial | Provider usage where returned, output limits and bounded repair rounds; no hard monetary budget. |
| Q04 | Show what data leaves the device, where it goes, and the applicable storage/retention controls | Partial | Connection destination and memory-sharing controls; no complete retention/data-governance UI. |
| Q05 | Clear online/offline capability indicators and useful local viewing/editing without cloud inference | Partial | Offline file/document viewing and editing; no universal connection-health indicator. |
| Q06 | Fast launch, background indexing, bounded history loading, and performance checks as the product grows | Partial | Deferred editor/terminal chunks, bounded memory retrieval and paged directories; indexing and startup benchmarks remain. |

### Filename discovery: 6 November 2026

Quick Open and Explorer now own cancellable, streamed filename scans. The old silent 20,000-entry cutoff is removed; result rows and active/queued work remain bounded, with exact counts and explicit unreadable-folder/depth outcomes. Tests cover owner isolation, closed roots, stale replies and handle cleanup; a native 21,001-match fixture checks actual editor contents, focus and cancellation. [Scope, measurements and remaining work](performance/FILENAME_SEARCH.md). The older cross-editor benchmark remains frozen and is not a measurement of this change.
