# Large code replies: bounded rendering and releasable owners

## What changed

Conversation rows already use `content-visibility: auto`. That skips some layout/paint, but a code block's CSS maximum height did not stop React/Shiki from creating every line and token node. A six-message fixture with three 2,000-line TypeScript replies retained 6,000 line elements and roughly 169,000 total DOM nodes.

Large blocks now lazily load a read-only CodeMirror viewport using the existing editor dependencies. The switch occurs at 1,001 lines or more than 100,000 UTF-16 code units. Blocks that have not crossed the threshold keep the previous renderer; an upgraded source block keeps its viewer if a later stream correction makes it smaller, preserving its view state. ANSI, diff and patch retain their existing parsers, including when an already-windowed block changes language. Grammars come from the shared source registry; the viewer starts no LSP, debugger, filesystem watcher or provider.

The full source remains primary data. Find searches the complete viewer document; the existing copy action receives the complete code string. A visible **Plain text** action supplies the complete DOM text for native browser selection and page search across a block. Virtualized lines alone are not a browser-wide search/selection surface. This is an explicit interaction tradeoff, not silent truncation.

Outside the viewport margin, an unselected/unfocused viewer is destroyed and its document/parser/DOM owner is cleared. A small value-only memento retains selection offsets, a scroll target, Find query and input selection. It retains no EditorState or EditorView. Focus and native ranges crossing the viewer pin it. Streaming updates append incrementally while active, and use the latest full text on reconstruction while parked. Appended payloads copy UTF-16 code units rather than keeping slices of previous complete stream snapshots; the helper preserves lone surrogates, CR/LF, NUL and BOM without UTF-8 normalization. The immutable source-editor document/history contract is unchanged.

## Reachability investigation

A WeakRef check initially failed even after the viewer DOM was removed. A native heap snapshot identified this strong path:

`title-bar button → React callback context → editTarget ref → disconnected Find input → input event listener → destroyed EditorView`

The title bar now holds a weak focus hint. A connected input remains owned by the document and can still be restored for Edit-menu actions; a disconnected input is no longer kept alive solely for optional focus restoration. This uses no finalizer, forced production GC or document eviction. The [captured retainer paths](code-viewport-retainer-path.txt) come from a 25 MiB disposable synthetic-profile snapshot with SHA-256 `522982eff2d9f47132aee2125a1765a9d77dad3f8550b27e71beccf2aa557681`. The large raw heap is not included in the repository. Set `TRIBUTARY_CODE_HEAP` to an absolute path to capture a future failed reachability probe.

## Measurement and verification

The paired report compares frozen `c40ea95` UI/desktop files against the current build. Both use the same current core, dependencies and saved synthetic replies, with agent discovery disabled. Each workload has three alternating fresh Linux Electron pairs and five post-diagnostic-renderer-GC samples per process. Summaries take the median within each process, then across the three processes. The runner rejects incomplete process accounting and checks source/UI fingerprints. No other tests or benchmarks run during the pairs.

These are settled retained-memory measurements, not normal GC behavior, allocation/peak limits, app startup/paint speed or model RAM/VRAM. Linux process-tree PSS excludes the display server and helpers outside the sampled app tree. Values are not additive to earlier Explorer/editor workloads. Small-reply results are included to expose the unchanged-renderer cost rather than infer a universal improvement.

Final [paired results](code-viewport-pairs.json), medians:

| Workload / metric | Baseline | Viewport |
| --- | ---: | ---: |
| Three 2,000-line replies: renderer JS heap | 34.48 MiB | 10.07 MiB |
| Same workload: total DOM nodes | 168,716 | 2,147 |
| Same workload: drawn code lines | 6,000 | 36 |
| Same workload: process-tree PSS | 570.61 MiB | 355.19 MiB |
| Same workload: process-tree private pages | 435.33 MiB | 202.16 MiB |
| Three 20-line replies: renderer JS heap | 10.779 MiB | 10.803 MiB |
| Small workload: total DOM nodes | 2,399 | 2,404 |
| Small workload: process-tree PSS | 346.22 MiB | 356.03 MiB |

The large workload's retained renderer heap falls about 71%, with about 215 MiB lower process-tree PSS. Small replies have roughly 25 KiB more retained JS heap and **9.81 MiB more PSS** in the aggregate medians; this is not a small-case RAM improvement. Per-pair small-case PSS differences are approximately +1.07, +9.81 and +0.10 MiB. The cause is not established by these samples, and the process-memory variation remains a follow-up concern.

The subsequent [same-build controls and direct-parent comparison](HIGHLIGHTER_OWNERSHIP.md) expose substantial process-PSS variation even without changing the build. They retain paired deltas alongside independent medians and do not rewrite the observations above or claim equivalence from three pairs.

An [earlier complete paired run](code-viewport-exploratory-pairs.json), before the language-transition safeguard, and an [intermediate run](code-viewport-intermediate-pairs.json), before an EOF-whitespace cleanup, are retained separately. They showed roughly 228 and 218 MiB lower large-case PSS, with near-flat small-case PSS. The final measurement was repeated to align exact source fingerprints after that cleanup; the built entry hash remained identical to the native correctness build. These runs expose variation rather than establish universal process-RAM savings. Single-line, very large unknown-language blocks are covered by the threshold policy but were not a separate paired workload.

The native correctness fixture verifies complete read-only text and last-line Find, focused/native-selected pinning, collection of the parked view, hidden and visible stream updates, same-view active append, selection/scroll/Find restoration, full copy payload, Plain text and Chromium-native `window.find`, safe threshold upgrade during native selection, wrapped plain tool output, a language switch back to ANSI, and a 390 px layout. Copy capture does not overwrite the system clipboard. Electron's host `found-in-page` event did not arrive even for a minimal isolated data page in this runtime; that host API is not counted as verified. Desktop/narrow screenshots were visually inspected.

The fixture's `cmTile` access, WeakRef probe, diagnostic collection and optional heap snapshot are version-pinned test instrumentation, not production rendering or collection policy.

The source-editor regression separately exercises six actual editors, dirty text, undo/redo, suspended diagnostics/parsers, formatter completion, and a real delayed disk save followed by a newer edit. Its memory samples are not part of this code-reply comparison. The Search regression checks that Edit-menu Find still restores a connected editor through the weak focus hint.

Evidence: [viewer checks](code-viewport-verification.json), [editor regression](code-viewport-editor-regression.json), [menu/search regression](code-viewport-menu-regression.json), [desktop](code-viewport-desktop.png), [390 px](code-viewport-narrow.png).

The final full regression suite passes **577 tests**, including the four new code-viewport helper checks. TypeScript, the production UI build and the VS Code bundle build pass. The final memory report's measured source fingerprints were rechecked after verification. This is source-app validation, not a newly built installer or native macOS/Windows certification.

The [isolated bundle audit](code-viewport-bundles.json) restores only Markdown, code-editor and title-bar sources to `c40ea95` for its baseline, keeping all other current source/config/dependencies identical. Cold hydrated-chat static JavaScript rises 1,064,366 → 1,067,122 bytes (gzip 326,642 → 327,790); total shipped JS rises 4,382,175 → 4,389,138 bytes. Neither cold-chat closure includes CodeMirror modules. The large-code chunk is deferred and shares the existing editor engine. These are static import-closure byte counts, not startup measurements or complete dynamic grammar-load totals. No new runtime package was added.

## Source and design evidence

- [CodeMirror system guide: viewport and update cycle](https://codemirror.net/docs/guide/#viewport): draw visible content plus a margin and destroy discarded views. [Read-only example](https://codemirror.net/examples/readonly/): state-level read-only, DOM editability and focusability are separate. Direct opens returned 403; the indexed official excerpts and installed published CodeMirror 6.43.15 source/types were inspected. This is not a claim to have read the whole manual. The official example also recommends a simpler highlighter for simple cases; small blocks retain that path here, while the large-node workload justifies the interactive viewport.
- [Crafting Interpreters, chapter 26](https://craftinginterpreters.com/garbage-collection.html), previously read in the research inventory: reachability, rather than visual disappearance, determines whether an owner can be collected.
- [Game Programming Patterns: Dirty Flag](https://gameprogrammingpatterns.com/dirty-flag.html) and [Data Locality](https://gameprogrammingpatterns.com/data-locality.html), previously read: keep primary data, release/reconstruct cold derived state, and measure the active working set. No C++ cache-layout speed factor is transferred to JavaScript.

This phase does not complete full-transcript virtualization, ANSI/diff token retention, all React/store references, dirty/undo working-set limits, model-memory optimization, natural-GC latency or cross-platform installer verification.

## Reproduce

After building the current UI, run `npm run bench:code-viewport -- /absolute/frozen-baseline-host /absolute/report.json`. The baseline host must contain the pre-change built UI and desktop, plus matching assets, package/dependencies and the same current core. The measurement runner does not rewrite or build either host. It requires Linux procfs, Electron and Xvfb.

For correctness, set `TRIBUTARY_CODE_MODE=viewport`, `TRIBUTARY_CODE_VERIFY=1` and `TRIBUTARY_CODE_OUTPUT=/absolute/report.json`, then run Electron with `scripts/performance/native-code-viewport.cjs`. The isolated profile and generated project are removed on exit. The bundle audit is `node scripts/performance/code-viewport-bundles.mjs /absolute/report.json`; its two Vite builds use temporary output directories and leave production dist untouched.
