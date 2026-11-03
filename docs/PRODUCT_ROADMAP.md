# Tributary roadmap for everyday users

Prepared 2 November 2026. Status: product and implementation plan; new capabilities below are proposed unless explicitly identified as existing.

Current implementation status for every candidate is tracked in [FEATURE_STATUS.md](FEATURE_STATUS.md). The latest memory, coordination, connector and live-file work is documented in [COORDINATION_AND_MEMORY.md](COORDINATION_AND_MEMORY.md).

## Product direction

**Tributary is a workspace where people bring a task and their materials, work with the right AI assistance, and leave with a useful result they can review and keep.**

Make everyday work the default experience. Retain the existing coding-agent workflow in an optional advanced area. People should be able to write, learn, research, compare documents, organize information, and prepare deliverables without knowing what a CLI, gateway, model protocol, MCP server, or Git repository is.

The advantage to validate is continuity across assistants and sessions: the task, relevant materials, decisions, and latest output stay together when the underlying assistant changes. Do not require users to compare models or coordinate an agent team before they receive value.

This roadmap expands the audience beyond the technical foundation in [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md). That document and [PERFORMANCE_ARCHITECTURE.md](PERFORMANCE_ARCHITECTURE.md) remain the engineering references. The feature catalog is a pool of prioritized work, not a commitment to build every item in the first release.

The multi-developer design is specified in [COLLABORATION_ARCHITECTURE.md](COLLABORATION_ARCHITECTURE.md). The first shared-room service and clients are now implemented: [setup, exact scope and validation](PROJECT_ROOMS.md). Automatic cross-machine execution, file synchronization, integrated previews and same-file editing remain later stages.

## Current foundation and actual gaps

| Area | Source-grounded current state | Required expansion |
| --- | --- | --- |
| Execution | Installed local coding agents plus `core/direct.js` for text-only compatible model services | Managed assistant access, more provider capabilities and account setup |
| Entry screen | `task-home.tsx` offers ten task templates and a personal workspace | More materials and an onboarding flow tested with nondevelopers |
| Connections | Guided local/compatible service forms alongside advanced agent gateways | Account connection and stronger provider-specific capability/cost checks |
| Results | Editable saved documents, revision history, Markdown/text export and existing file review | Tables, richer document formats and broader previews |
| Memory | Markdown project facts and work log in `core/memory.js`; session handoff in `core/handoff.js` | User-controlled personal/workspace memory with sources and privacy scopes |
| Recovery | `core/checkpoint.js` snapshots Git working trees | Staged file changes and recovery for ordinary non-Git folders |
| UI integration | Desktop and extension expose task/document, directory and shared-room methods | Keep verifying host API → core → persistence → UI for each released action |
| Performance | Startup improvements and local traces exist from the previous pass | Maintain startup quality while adding extraction, indexing, previews, and sync |

These observations establish implementation scope. They do not constitute user research or a guarantee that every current flow works on every supported platform.

## Who to serve first

| User | First useful job | Proof of value |
| --- | --- | --- |
| Student or learner | Understand an uploaded handout and prepare a study guide | Can find the explanation in the source and export the guide |
| Office worker | Compare three documents and draft a short recommendation | Can inspect the comparison and edit the recommendation |
| Freelancer or small-business owner | Turn notes into a client-ready proposal | Can correct details and export a usable document |
| Creator or marketer | Turn a brief into a content outline and draft | Can select a tone, edit text, and reuse the result |
| Personal user | Organize notes into a plan or checklist | Can finish a task without configuring an agent |
| Developer | Continue existing code work across local assistants | Existing execution, review, and handoff remain available |

Initial delivery should validate the first three workflows. Expand to other audiences using the same underlying workspace and artifact model, rather than creating a separate dashboard for every occupation.

## The first-use journey

1. **Choose an outcome.** The home screen offers “Understand a file”, “Write something”, “Compare information”, and a free-text request.
2. **Try a demonstration or connect an assistant.** A clearly labeled demonstration can show a finished example without pretending it ran live. Real work requires a tested local or cloud connection, with cost and data destination explained.
3. **Add materials when useful.** Drop files, paste notes, or add a link. A task can start without a folder or uploaded file.
4. **Answer only necessary questions.** For a document draft, ask about audience and desired outcome if missing. Skip role surveys, a model picker, and integrations that the task does not need.
5. **Review the result beside the conversation.** Edit text directly or ask for a revision; inspect source references where applicable.
6. **Keep the outcome.** Export, save to the workspace, or continue later. Ask before applying external changes or sending anything.

Proposed activation event: a new nontechnical user creates or analyzes a real item, reviews the result, and successfully saves or exports it without assistance. Measure this before optimizing template clicks or chat-message counts.

## Navigation and language

Proposed primary navigation: **Home · My work · Files · Saved knowledge · Connections**. Settings and the advanced developer workspace remain easy to find but outside the first task path.

| Existing concept | Everyday presentation |
| --- | --- |
| Agent / model choice | Assistant, with “Choose automatically” as the default |
| Project directory | Workspace; attach a folder only when needed |
| Thread | Conversation or task, according to the screen |
| Gateway / MCP | Connections; technical details under Advanced |
| Tool trace | Activity: what was read, created, or changed |
| Diff / checkpoint | Changes / previous version |
| Read-only / edit / full auto | “Read these items”, “Create a draft”, or a specific action permission |

Use one interface with progressive disclosure. A preference can reveal technical controls; it should not create an incompatible copy of the user's work. Permission changes must be separate from an interface preference.

## Feature catalog: 80 candidates in 13 groups

Release labels: **Foundation** enables the first general-user experience; **First release** completes the initial useful workflows; **Expansion** adds repeated daily value; **Later** needs additional product validation or infrastructure. Every item below is planned, including items that extend an existing core feature.

### 1. Getting started

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| G01 | Built-in assistant connection: do useful work without installing coding software | Foundation |
| G02 | Guided connection setup: explain account, data destination, limits, and a harmless connection test | Foundation |
| G03 | Installers with tested OS support, clear updates, and a recoverable failed update | Foundation |
| G04 | Clearly labeled example workspace with a useful sample outcome and no surprise charges | First release |
| G05 | Optional goal-based starter suggestions, with a visible skip action | First release |
| G06 | In-app help and actionable setup errors, including a masked diagnostic report | First release |

### 2. Task-first workspaces

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| W01 | Outcome-based home screen: write, understand, compare, organize, or ask freely | Foundation |
| W02 | Personal workspaces holding related tasks, materials, and outputs without requiring Git | Foundation |
| W03 | Guided task templates that collect only the inputs necessary for the chosen result | First release |
| W04 | Recent work and “Continue where I left off”, with a concise progress summary | First release |
| W05 | Search, rename, pin, archive, duplicate, and organize work with familiar controls | Expansion |
| W06 | Optional advanced controls for developers while preserving the everyday workflow | Foundation |

### 3. Bring useful materials

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| D01 | Drag-and-drop PDF, DOCX, Markdown, and text with extraction status and limits | First release |
| D02 | Images and scanned-document text extraction, with page references and quality warnings | Expansion |
| D03 | CSV/XLSX import with worksheet selection, type preview, and original-file preservation | Expansion |
| D04 | Audio upload or explicit recording with a reviewable transcript | Expansion |
| D05 | Choose files or folders, see exactly what is accessible, and search permitted contents | First release |
| D06 | Web links and a source library showing origin, retrieval time, and inaccessible content | Expansion |

### 4. Everyday jobs

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| U01 | Writing assistant: draft, shorten, rewrite, translate, and adjust tone | First release |
| U02 | Document questions and summaries linked to the supplied evidence | First release |
| U03 | Document comparison: differences, common points, missing information, and a recommendation draft | First release |
| U04 | Study help: explanations, study guides, flashcards, and practice questions from chosen sources | First release |
| U05 | Research briefs with source links, dates, and clear distinction between facts and inference | Expansion |
| U06 | Spreadsheet cleanup and analysis with a proposed transformation and verified calculations | Expansion |
| U07 | Proposals, briefs, meeting notes, and action-item drafts using editable templates | First release |
| U08 | Personal plans, schedules, checklists, and simple budget organization from user-supplied details | Expansion |

### 5. Useful results outside chat

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| O01 | Editable document panel beside the conversation, with changes saved independently of chat | Foundation |
| O02 | Tables and charts first; slide and visual drafts later when rendering/export is dependable | Expansion |
| O03 | Verified PDF/DOCX/Markdown export first; CSV/XLSX and slide exports as those artifact types ship | First release |
| O04 | Named versions, before/after comparison, and restoring a prior output | First release |
| O05 | Clear copy, download, print, and “open containing folder” actions where supported | First release |
| O06 | Completion checklist showing delivered files, unsupported requests, and remaining user decisions | First release |

### 6. Clear control over actions

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| C01 | A short understandable plan for multi-step actions, with the option to adjust scope | First release |
| C02 | Task-specific read/create/change permissions listing actual folders and connected tools | Foundation |
| C03 | Review the exact recipients, content, destination, and cost before an external action is approved | Foundation |
| C04 | Stage proposed file edits and keep recoverable copies for non-Git workspaces | Foundation |
| C05 | Stop, cancel, and resume where safe, with completed and partial work clearly identified | First release |
| C06 | Change history and honest undo boundaries; no implied recall of an already-sent message | First release |

### 7. Memory people understand

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| M01 | Separate personal preferences, workspace knowledge, and temporary task state | Foundation |
| M02 | Saved-knowledge screen with view, edit, pin, forget, history, and source information | First release |
| M03 | “Remember this” and “Use only for this task”, with a visible storage scope | First release |
| M04 | Session summaries that preserve goals, decisions, current output, and pending work across assistants | First release |
| M05 | Expiration and stale-source detection; sensitive details excluded from durable personal memory by default | Expansion |
| M06 | Memory export and deletion that covers derived summaries, indexes, and cached context | First release |

### 8. Assistance without model expertise

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| A01 | Automatic task routing within the user's chosen providers, capabilities, permissions, and budget | Foundation |
| A02 | Simple speed/detail preferences with provider/model details available on demand | First release |
| A03 | Optional second opinion or review that states additional provider use and estimated cost | Expansion |
| A04 | Switch assistant while keeping the same materials, current output, and useful task summary | First release |
| A05 | Quota and failure recovery; ask before a fallback changes data destination, price, or permissions | First release |
| A06 | Capability checks: disable unsupported files/tools rather than imply every assistant can handle them | Foundation |

### 9. Connections to existing work

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| I01 | Google Drive/OneDrive file access with source-level permissions, starting with read access | Expansion |
| I02 | Gmail/Outlook drafts and thread summaries; sending is a separate reviewed action | Expansion |
| I03 | Calendar reading and proposed events; invitations require reviewed details and permission | Expansion |
| I04 | Notion/Slack knowledge lookup with citations, permission checks, and disconnect controls | Later |
| I05 | Browser-assisted tasks with visible steps, scoped access, and paused consequential submissions | Later |
| I06 | Portable workspace export/import with sources, outputs, and a preview of included personal data | Expansion |

### 10. Repeat useful work

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| R01 | Save a successful task as a reusable recipe with clearly editable inputs | Expansion |
| R02 | Preview each recipe run's files, actions, and cost; grants remain tied to scope | Expansion |
| R03 | Scheduled tasks that show the next run, last result, and whether the computer must remain awake | Later |
| R04 | Source-change triggers with deduplication, stop controls, and notifications for meaningful changes | Later |
| R05 | Batch processing with preview samples, per-item status, retry, and partial-success reporting | Expansion |
| R06 | A simple recipe builder assembled from tested steps, after templates prove demand | Later |

### 11. Accessibility and language

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| X01 | Full keyboard operation, visible focus, screen-reader labels, and meaningful status announcements | Foundation |
| X02 | Readable type, zoom, sufficient contrast, reduced motion, and comfortable result layouts | Foundation |
| X03 | Localized interface and help, translation-ready content, and right-to-left layout support | Expansion |
| X04 | Optional voice input and read-aloud, with explicit recording state and a complete text alternative | Expansion |
| X05 | Small-window layouts first; a secure mobile/web companion when sync and identity are ready | Expansion |
| X06 | Examples, plain-language errors, accessible support, and context-preserving retry actions | First release |

### 12. Working with other people

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| T01 | Shared workspaces with deliberate invitations and clear ownership | Later |
| T02 | Viewer/editor/admin permissions that protect personal memories and restricted sources | Later |
| T03 | Comments, requested revisions, approval assignments, and human task handoff | Later |
| T04 | Shared team templates and approved workspace instructions | Later |
| T05 | Workspace usage limits and an activity record of who did what | Later |
| T06 | Restricted sharing links with expiration, revocation, and a preview of what recipients see | Later |

### 13. Cost, privacy, and reliability

| ID | Feature and user benefit | Release |
| --- | --- | --- |
| Q01 | Autosave and crash recovery with clear saved, saving, failed, and recoverable states | Foundation |
| Q02 | Plain-language diagnostics with secrets removed and user-controlled report sharing | First release |
| Q03 | Usage estimates, available provider-reported actuals, hard execution limits, and budget notifications | Foundation |
| Q04 | Show what data leaves the device, where it goes, and the applicable storage/retention controls | Foundation |
| Q05 | Clear online/offline capability indicators and useful local viewing/editing without cloud inference | First release |
| Q06 | Fast launch, background indexing, bounded history loading, and performance checks as the product grows | Foundation |

## Ten launch templates

Ship a small curated set with sample inputs, required fields, output preview, and an explicit completion check:

1. Summarize this document and show the important passages.
2. Compare these documents in a table.
3. Turn these notes into a proposal.
4. Rewrite this text for a chosen audience.
5. Translate this document while preserving names and structure.
6. Explain this handout and create a study guide.
7. Create practice questions from these materials.
8. Turn pasted meeting notes into actions and open questions.
9. Create a project brief from a rough idea.
10. Review and improve an existing draft while showing changes.

Keep these within the first-release document/text capabilities. Audio transcription, connected email, live web research, and spreadsheet automation should appear only when their dependencies are released and tested. Templates should never advertise an unsupported action.

## Architecture required for nontechnical use

### A connection path independent of coding CLIs

Current gateways configure an underlying agent; changing their labels does not remove the installation prerequisite. Add a runtime abstraction with the existing local-agent implementation and a direct-provider implementation that both emit normalized task events.

For a first usable release, implement one tested direct-provider connection alongside existing local agents. Show a task-oriented setup instead of protocol fields. A managed hosted account is a later product option requiring authentication, billing, quotas, and operating-cost controls. Use authorized provider flows; do not assume an existing consumer chat subscription supplies API credits or integration rights.

For private credentials, use the supported OS credential store. If it is unavailable, offer an explicit session-only or documented supported alternative rather than silently describing plaintext storage as encrypted. The current desktop secret implementation contains a plaintext fallback that must be resolved for this promise.

### Workspaces and durable results

Introduce a workspace identity independent of a filesystem path. A workspace owns source references, tasks, conversations, editable artifacts, revisions, scoped memories, and action history. It may attach an authorized folder, but ordinary writing should work before that attachment exists.

Keep conversation history separate from the current document or spreadsheet state. Revise an artifact through an operation against an expected version so a delayed assistant response cannot silently replace a user's latest edit. Show conflicts and allow recovery.

### A tool and permission layer

File reading, extraction, document creation, research, and external connectors need capability-specific operations. Text generation alone does not implement these tasks. Keep parsing and untrusted documents outside the window process, bound time/memory, and preserve provenance. Document content is data; embedded requests must not gain permission to send messages or change files.

Reading a folder, editing a file, and sending an email are separate permissions. Stage consequential changes and display the concrete result immediately before approval. A user-approved recipe can run within its precise scope; changed destinations, recipients, budget, or access require review. Record externally applied actions and do not duplicate them on retries.

For non-Git recovery, preserve originals before applying edits, detect external modifications, and show a preview before restoring a version over newer work. A canceled task must say which actions already completed.

### File understanding and search

Begin with supported PDF, DOCX, Markdown, and text extraction, then add images/OCR, spreadsheets, and audio. Publish file-size/type limits and show whether extraction is complete, partial, unsupported, or failed. Cite page/paragraph/sheet/cell references where applicable. Do not report a document-wide answer when only a partial extraction was examined.

Start with scoped full-text retrieval and source-aware summaries. Add semantic indexing when measured tasks justify it. Follow the existing performance plan: incremental persistence and smaller updates first; native indexing is a later measured optimization rather than a prerequisite for an accessible first release.

### Optional services

Device sync, shared workspaces, hosted schedules, and managed assistant access require a backend with identity, authorization, quotas, and data controls. A desktop-only scheduler cannot promise runs while the machine is asleep. Connector authorization must be revocable and enforced during retrieval, sharing, background indexing, and export.

## Delivery sequence and release gates

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0. Verify foundations | Map every exposed action to core/persistence/UI, inventory support, prototype three nontechnical jobs | No advertised core action lacks a working end-to-end path; target users understand the proposed journey |
| 1. General-user foundation | Direct assistant connection, task home, folder-independent workspace, scoped access, artifact editor, cost controls | A clean supported-machine setup completes a text task with no coding CLI installed |
| 2. First useful release | File summaries/comparison, writing/study templates, export, versions, saved knowledge, session continuation | Users complete and export the three target workflows without assistance |
| 3. Daily-work expansion | Spreadsheets, source-linked research, OCR/audio, first read-only cloud connection, reusable recipes | Each added workflow has extraction/tool tests, predictable cost, and a recoverable failure path |
| 4. Collaboration and recurring work | Identity/sync, shared workspaces, reviewed external actions, schedules, mobile companion | Permissions, duplicate-action prevention, device availability, and recovery hold across users/devices |
| 5. Advanced ecosystem | More providers/connectors, no-code recipe builder, capability-scoped extension catalog | Extensions have explicit permissions, compatible versions, and a dependable install/update/remove path |

These phases are dependency order, not calendar estimates. Size and schedule them after a technical spike for direct-provider execution, document extraction/export, and non-Git recovery. Preserve the existing developer lane during expansion.

## First implementation backlog

| Order | Deliverable | Existing touchpoints | Acceptance |
| --- | --- | --- | --- |
| 1 | Inventory desktop API coverage and supported workflows | `desktop/main.js`, `core/hub.js`, UI callers | Every surfaced action has a named owner and executable acceptance check |
| 2 | Define Workspace, Task, Source, Artifact, Revision, ActionGrant | `core/store.js`, `core/hub.js`, `ui/src/types.ts` | Migrate an existing project without losing messages or session identities |
| 3 | Implement one direct-provider runtime | `core/runner.js`, `core/gateways.js`, new runtime adapter | Fresh machine without agent CLIs can complete and cancel a text task |
| 4 | Create guided connection and cost setup | `desktop/main.js`, settings, secret store | Explain destination/cost; validate connection; store/revoke credentials safely |
| 5 | Add task-first Home and a plain-language composer | empty state, sidebar, composer, store | Start a task without selecting an agent or choosing a code directory |
| 6 | Add durable artifact editing and version-aware updates | new artifact service and result panel | Manual edits survive restart and delayed assistant revisions |
| 7 | Add bounded document ingestion and evidence references | new extraction worker/service and source UI | Supported documents produce inspectable extraction; bad files fail clearly |
| 8 | Add ten curated templates and first exports | task definitions, artifact rendering/export | Exported files open correctly and match the reviewed content |
| 9 | Add saved-knowledge controls and useful continuation | `core/memory.js`, `core/handoff.js`, new inspector | Correct/forget a fact and resume a task without leaking another workspace's context |
| 10 | Add non-Git staged changes and recovery | new file revision service; existing Git checkpoint adapter | Preview/apply/restore preserves the original and detects newer external edits |
| 11 | Validate with nontechnical users | complete workflow and supported installer | Meet activation gates and fix observed blockers before adding integrations |

This is the minimum coherent general-user product. An API call working in isolation is insufficient: each item must connect through desktop/runtime/persistence/UI and survive the relevant restart, cancel, export, and permission cases.

## Research informing the plan

| Primary source | Observed pattern | Product inference for Tributary |
| --- | --- | --- |
| [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) | Related chats, files, and instructions form reusable project context; project-only memory constrains context sharing | Keep work together and make memory scope understandable |
| [Claude Cowork overview](https://claude.com/resources/guides/claude-cowork-product-guide/product-overview) and [getting started](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) | Knowledge-work tasks involve local files, connected tools, and explicit permissions | General-user usefulness requires dependable actions and file controls as well as chat |
| [Microsoft Copilot Pages](https://support.microsoft.com/en-us/microsoft-365-copilot/draft-content-with-microsoft-365-copilot-chat-and-copilot-pages) | A response can become an editable page beside the conversation | Give deliverables a persistent editable surface |
| [Notion AI Connectors](https://www.notion.com/en-gb/help/notion-ai-connectors) | Connected knowledge has setup and existing-permission requirements | Build access checks into connectors and retrieval from the start |

These sources establish product patterns, not proof of demand for Tributary or of the effectiveness of this proposed design. Validate the first workflows with the intended audience before committing to the long tail of features.

## Validation targets

Recruit at least ten participants who do not regularly use coding tools, spanning students, office work, and freelance/small-business tasks. Test on clean supported systems and ordinary non-Git folders. Include keyboard-only and screen-reader sessions. Observe the task rather than teaching the interface first.

- At least 8/10 complete the first supported task and save/export a useful result without assistance.
- Aim for a median under five minutes from a ready installation to first reviewed output; report account/setup time separately, and include it in the overall activation funnel.
- At least 8/10 can explain what files were accessed, what was changed, and whether work was shared externally.
- A canceled task clearly identifies completed actions and recoverable partial work.
- Source references resolve to the evidence used; incomplete extraction never silently appears complete.
- Exported documents open, preserve reviewed content, and retain expected formatting; spreadsheet calculations and chart source values reconcile when those formats ship.
- Deletion, disconnect, and permission changes propagate to derived context and sharing paths.
- Record setup abandonment, task success, correction effort, perceived usefulness, support requests, and later reuse. Treat small-study percentages as release heuristics rather than population estimates.

For retention, measure later return behavior after an early activation window with mature cohorts; do not define success using the same action in both periods. Product telemetry should be opt-in where appropriate and avoid recording private file contents.

## Scope discipline

The first release does not need a marketplace, an autonomous browser, dozens of model choices, team billing, or a mobile app. Those are catalog candidates with prerequisites. Its strongest demonstration is a person who has never used a coding tool turning their own materials into a correct, editable, saved result, then returning later to continue without starting over.
