# Tributary UI refinement: design QA

Date: 3 November 2026. Final result: **passed**.

Scope: adapt the supplied references to the existing Tributary product and refine small controls. This is a local implementation review, not an assertion of a pixel-identical clone or production certification.

## Visual truth and rendered evidence

- Conversation reference: `/tmp/codex-clipboard-010e0ec1-d6ca-4cb5-8a02-4323a6078cee.png`, 1920 × 1158 pixels. Dark desktop chat, project sidebar, expanded tool output, environment/context panel, bottom writing bar and separate controls.
- Small-control reference: `/tmp/codex-clipboard-b52ec9f2-3bf6-4803-b417-5a83482725da.png`, 1080 × 155 pixels. This is a partial capture of agent/model/permissions selectors and a compact zoom group, not a full viewport.
- Workbench reference: `/tmp/codex-clipboard-0d87ed73-5ddd-43db-9596-317c2409672a.png`, 1024 × 768 pixels. Existing editor-first layout is retained as an explicit alternative to Chat view.
- Full implementation: [settled desktop Chat view](docs/performance/reference-chat-1920.png), captured in the actual isolated Electron renderer at 1920 × 1158 CSS px, devicePixelRatio 1; image is 1920 × 1158 pixels. No density resampling.
- Small-control evidence: [desktop selectors](docs/performance/micro-alignment-1920.png), [390 px selectors](docs/performance/micro-alignment-390.png), [390 px image controls](docs/performance/micro-zoom-390.png). The partial reference was inspected together with the implementation captures; sizes are judged through their local row geometry rather than stretching the source crop to a full viewport.
- Editor/image evidence: [editor](docs/performance/editor-refined-1280.png), [image viewer](docs/performance/image-viewer-1280.png), [expanded image](docs/performance/image-expanded-1280.png).

The full source and full implementation were presented together for visual comparison, followed by the small-control source and phone selector/zoom captures in one comparison input. After the final desktop capture, connector loading had settled to its actual configured count. The fixture is explicitly labeled local UI preview, with actual local regression output; no agent request was sent.

## Findings and comparison history

| Earlier finding | Fix | Post-fix evidence / disposition |
| --- | --- | --- |
| P2: sidebar/context proportions and central composer placement drifted from the conversation reference. | Project sidebar 288 px, optional context panel 320 px; wide conversation and writing bar align toward the reference's reading column. Existing Workbench remains an explicit switch. | Full desktop screenshot above; 27 reference-layout checks. Resolved for the selected adaptation. |
| P2: muted tool-description opacity reduced contrast. | Removed additional opacity from the muted text token. | Expanded tool output and reference-context accessibility results. Resolved. |
| P2: phone rules hid the agent identity badge together with its label. | Hide only the named label; retain the 16 px badge. | Both 320/390 px screenshots and measured DOM checks. Resolved. |
| P2: chat title could overflow into header actions. | Bound the heading to its flex container and retain truncation. | 390 px screenshot; header separation checked at all six widths. Resolved. |
| P2: button dimensions animated across responsive breakpoints. | Limit transitions to colors, borders and shadow. | Immediate 32/44 px target measurements at all six widths. Resolved. |
| P3: selector glyphs and padding looked uneven despite matching centers. | Shared 8 px horizontal padding, 6 px gap, 20 px label line, 16 px action/identity icons and 12 px chevrons. | Center differences under 0.5 CSS px. Resolved. |
| P3: zoom controls lacked the reference's compact grouping. | Rounded minus/percentage/plus group; retained Fit, Actual size and Expand. | Zoom screenshots at 1280/768/390/320 px and functional checks. Resolved. |

No actionable P0/P1/P2 finding remains within this scope. Expected differences: Tributary branding and existing Lucide controls are retained; native window chrome and the reference's conversation content are not duplicated. The shorter fixture changes vertical content density. Remote Control, token-window percentages and connection-health claims are omitted because the underlying capabilities are not established. The context panel reports recorded memory and configured entries. These are intentional product adaptations, not claims that every depicted upstream feature was implemented.

## Required fidelity surfaces

- **Typography:** bundled Geist Variable with system fallback for UI, existing monospaced code font. Chat footer selectors are 12 px, compact workspace labels 13 px, reply text 13 px desktop / at least 14 px phone. The source font is visually similar but not identified with certainty. Weight, label line height, chevrons, truncation and wrap were inspected. Keyboard focus remains visible.
- **Spacing and layout:** 36 px desktop toolbar rhythm, 32 px desktop actions and 44 px phone actions. The small selectors share centerlines and padding. Filename/breadcrumb/footer hierarchy remains separate; no individual frame around an opened file. Saved sizing preferences and unsaved file drafts survive view changes.
- **Color and tokens:** neutral near-black chat/background, slightly distinct sidebar and editor surfaces, quiet borders, existing semantic agent/file colors. Final selector surfaces and expanded tool output pass the recorded contrast scans; no opacity-only selected state is required.
- **Assets and images:** existing bundled icons/branding retained. No replacement illustration or remote asset dependency added. Real project images preserve their aspect ratio and full raster payload within the 16 MiB cap, support transparency and zoom, and show short failures instead of partial image data. The large source screenshot is loaded as a real project-image fixture.
- **Copy and state:** concise tooltips and button labels; details remain in menus. Actual branch, configured MCP count and recorded memory sources are shown. Preview fixture text distinguishes local checking from a real agent run. No fabricated task completion or model execution.

## Validation and gaps

- 53 final small-control checks, 35 image/editor checks and 27 reference-layout checks passed in the isolated Electron renderer.
- Widths: 320, 390, 768, 900, 1280 and 1920 px. Small-control checks cover icon/text centers, target sizing, title separation, no viewport overflow, Escape/focus return, image zoom and retained identity marks.
- 15 scoped accessibility scans reported zero violations: eight image/editor/features surfaces, five reference Chat view/context/sidebar surfaces and two final phone selector/image surfaces. Resting and intentionally disclosed states were checked after transitions. Open-tooltip combinations and all assistive-technology/platform permutations are not comprehensively audited; incomplete results remain in the JSON evidence for manual review.
- TypeScript, production UI build, extension packaging and 30 focused regression tests passed. Final renderer console and uncaught-error logs were empty.
- Primary interactions checked: view switches, unsaved draft retention, file navigation, image fit/zoom/full-screen/focus return, Markdown images, live disk updates, wrapping/cursor status, real feature navigation and context drawer. No model call, team execution or deployment was performed by these checks.
- Test harness corrections: scroll-driven fade animations stay logically running and must not be awaited as time-based transitions. An audit during a tooltip closing animation was rerun after settling; it is not recorded as a stable-state product contrast failure.

Evidence: [small controls](docs/performance/micro-alignment-validation.json), [reference layout](docs/performance/reference-chat-validation.json), [image/editor](docs/performance/image-editor-validation.json), [reference accessibility](docs/performance/reference-chat-accessibility.json), [image/features accessibility](docs/performance/image-features-accessibility.json), [console](docs/performance/ui-console-validation.json).

## Implementation checklist

- [x] Match compact selector geometry and preserve phone identity marks.
- [x] Keep text clear of header controls and retain accessible focus.
- [x] Verify image zoom and responsive control targets.
- [x] Compare final screenshots and save validation evidence.
- [x] Retain existing project drafts, native handlers and saved panel preferences.
