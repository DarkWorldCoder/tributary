# Historical reply rendering lifetime

The source conversation previously mounted every reply's React/Markdown tree. CSS `content-visibility: auto` skipped some layout/paint work, but kept the DOM and derived rendering alive. The fixture reproduces that cost with durable history, formatting, links, tables, snippets and a large read-only code viewer.

## Measured result

After scrolling from the end through the beginning/middle and returning, the sixty-reply workload retains **31.10 → 17.65 MiB renderer heap**, **74,461 → 5,315 renderer DOM nodes**, and **391.47 → 351.86 MiB measured app-tree PSS**. All three pairs save process PSS: −30.32, −42.14 and −39.67 MiB. The derived rich working set returns to three recent bodies, while all sixty original source texts remain exact.

| Returned-to-bottom workload | Baseline | Adaptive release |
| --- | ---: | ---: |
| 60 rich replies: renderer retained heap, MiB | 31.10 | 17.65 |
| 60 rich replies: renderer DOM nodes | 74,461 | 5,315 |
| 60 rich replies: app-tree retained PSS, MiB | 391.47 | 351.86 |
| 4 small replies: renderer retained heap, MiB | 10.53 | 10.56 |
| 4 small replies: renderer DOM nodes | 1,236 | 1,248 |
| 4 small replies: app-tree retained PSS, MiB | 334.91 | 337.40 |

The small case adds about 30 KiB of renderer retained heap and twelve DOM nodes. Its paired PSS differences are +7.90, +2.49 and −0.23 MiB; it does **not** establish lower RAM for short chats. The final short-chat path avoids body observer/release work, but its wrapper/state cost is not zero.

Median latest-reply DOM-ready observation is 1,674 → 955 ms for the large case, and 670 → 679 ms for the small case. These include fixture polling and IO and do not prove paint completion, natural GC latency or universal startup speed. All **288 final process-tree samples** are complete, with no rejected attempts.

The clean temporary bundle audit adds **4,574 minified JavaScript bytes / 1,485 gzip bytes** to the cold-chat static closure. CodeMirror, the code viewer and local-model setup remain outside that static closure. No dependency is added. Runtime memory savings and shipped bytes are separate measurements.

All **598 regression tests**, fourteen grouped native desktop behavior checks, the long-chat capability fallback, TypeScript and production UI/extension builds pass. The native behavior check also proves an existing code viewer survives adaptive activation as a chat grows. It does not certify every assistive technology; full-content mode and keyboard reveal are available.

[Paired data](transcript-memory.json) · [Verification](transcript-verification.json) · [Native behavior](transcript-behavior.json) · [Compatibility case](transcript-fallback.json) · [Bundle audit](transcript-bundles.json) · [Desktop screenshot](transcript-memory.png) · [Narrow screenshot](transcript-narrow.png).

## Product behavior

History windowing activates after **24 messages** or **131,072 UTF-16 source units** in a conversation. These are activation heuristics, not a heap-memory limit. Short conversations keep the earlier layout path and do not attach the new body observers. Activation does not replace existing reply components; an already-used code viewer survives the transition.

The latest six messages and live responses keep their rich bodies. Historical bodies within an 800 px viewport margin also render normally. Older, unselected bodies release their Markdown/highlight/DOM rendering; the thread retains its original text. A parked body keeps a height estimate or its most recently measured height, escaped raw text in a native-searchable node, and a keyboard-reachable **Show reply** action. Heights are estimates before first rendering and after layout-width changes, not guaranteed exact scroll distances.

| Situation | Body behavior |
| --- | --- |
| Recent, live or near viewport | Rich Markdown remains available |
| Older and offscreen | Derived rich subtree released; original source kept |
| Focus or native selection intersects reply | Rich body retained, including selection spanning several replies |
| Code viewer used, or rich reply explicitly revealed | Parent rich body stays available for that conversation; the existing viewer may independently park its own DOM while retaining Find/selection state |
| Native browser search finds parked source | Same source node becomes visible as plain text; **Show formatted reply** restores rich formatting on request |
| Select All spans old replies | Intersected bodies reappear so rendered reply text remains selectable |
| Print preparation | All reply bodies reappear temporarily; this does not prove full printing of virtualized code-viewer lines |
| Chat menu → Show all reply content | All rich bodies remain available; preference persists locally |
| Required browser capability absent | All rich bodies remain available |
| Chat closed/switched | Observer, listener and registry owner disposed; captured body roots can be collected |

Explicit code interaction/reveal actions, selection, full-history mode and live work intentionally override release. Headers, tools, approvals, file actions and user messages retain their existing owners. No conversation text, tool record, retry/resume state or durable message is removed. This is not constant-space memory for arbitrary histories: source text and message metadata still grow, and user-pinned rich views can grow too.

Chrome's [hidden-until-found guide](https://developer.chrome.com/docs/css-ui/hidden-until-found) explains native search reveal and capability detection. The implementation keeps a stable text node for that reveal rather than replacing the matched node during a search. A [current Chrome guide](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/search-hidden-content) also describes delegated reveal handling and browser fallbacks. The raw source is ordinary escaped React text; rich content still uses the existing Markdown renderer. [Reading scope](transcript-reading.json). Embedded examples were not executed. This is targeted platform-source reading, not a claim to have read every memory-management book.

## Verification boundaries

The native desktop check covers exact durable source preservation; native Find revealing an old reply and formatting it again; offscreen selection and subsequent release; used code-viewer Find state; selection across old replies; narrow layout; print events; keyboard reveal/focus; full-history menu controls; weak-reference collection of captured body roots after chat switch; reopening; activation while preserving an existing viewer; and independent activation by source volume below the message-count threshold.

The compatibility fixture removes the actual inherited browser capability before a new document starts. It keeps its diagnostic session attached through navigation so the override applies. It tests a long conversation that would normally activate windowing. This is a controlled Chromium capability test, not a native Safari/Firefox or screen-reader certification.

Exploratory fixtures initially exited before the positive native-find update, targeted a code viewer below the current viewport, delivered Enter without its native character event/window focus, and detached the capability override before navigation. Those test assumptions were corrected. Their failed runs do not supply final paired measurements. A first implementation also applied windowing to short chats; its small-chat process-memory results were mixed. The adaptive final implementation retains the simpler short-chat path.

## Measurement method

The final comparison uses three fresh serial pairs for each of two workloads: four small replies and sixty rich replies. The middle pair reverses order. Both variants use the same current core, dependencies, temporary profile and native fixture; the baseline freezes UI/desktop at `8083acb`. Four positions are checked: initial bottom, start, middle and returned bottom. Each boundary records five complete process-tree observations followed by a separately labelled diagnostic renderer collection and retained heap/DOM/process-tree sample. Incomplete procfs attempts are retained separately and never contribute totals.

Reported retained memory is **after diagnostic renderer GC**. Earlier boundaries have also requested collection, so the preceding observations are not an uninterrupted natural-heap/GC-pause experiment. No production collection or heap flag is added. Sources and the entire measured UI build are fingerprinted, and tests/builds/other benchmarks do not overlap the paired cases. Medians are descriptive; order is alternated rather than randomized. Ready-time observations include fixture polling and IO, not paint completion or universal app throughput.

The process tree includes Electron main/renderer/utility/graphics descendants. It excludes Xvfb, detached/reparented helpers, external model runtimes, OS page cache and driver allocations outside those descendants. The fixture uses saved synthetic history and disables agent discovery/update polling. Native Windows/macOS, installers, arbitrary workloads, real providers, uninterrupted GC latency and universal leak freedom remain unverified.

Reproduce with a frozen baseline host containing the original desktop files and production `ui/dist`, plus links to current core/dependencies/assets:

```sh
node scripts/performance/transcript-retention.cjs /absolute/baseline-host /absolute/results.json
node scripts/performance/transcript-bundles.mjs /absolute/bundles.json
```

Run them separately after stopping tests/builds. The bundle audit builds clean temporary outputs without rewriting the measured production UI. Its baseline restores only the four existing UI/store files to `8083acb`; the new body module is unreachable there. The native fixture also accepts `TRIBUTARY_TRANSCRIPT_VERIFY=1` for functional checks and `TRIBUTARY_TRANSCRIPT_FALLBACK=1` for the controlled compatibility case.

Full transcript metadata virtualization, dirty/undo working-set budgets, natural peak/GC-pause profiling and broader model/GPU behavior remain open under the original optimization goal.
