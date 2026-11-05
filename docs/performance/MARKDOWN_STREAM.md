# Streamed Markdown ownership and work

## Problem and implementation

The old splitter ran `text.split('\n')` over the entire reply on every update and rebuilt the block list. A one-line block's `join` could return a substring sharing the full reply buffer. Memoized unchanged Markdown children then kept that historical buffer reachable. The actual Electron heap shows a strong path from a mounted paragraph's React Fiber through `pendingProps.children`, a sliced string and its full-reply parent. A shrinking visible output or a successful cancellation flag would not remove that owner.

The per-Markdown cache now scans newly completed lines, records numeric spans for its unfinished block, and reuses completed groups of 64 blocks. Groups add no DOM wrapper. A changed prefix, rewind or threshold change invalidates derived work; reference definitions preserve whole-document parsing. New or changed partial block strings are materialized through native JSON string serialization/parsing, preserving all UTF-16 code units, including lone surrogates. A parsed substring may share that newly serialized **block-sized** allocation; the current-runtime heap check verifies it does not share an older full-reply buffer. This is an observed V8 implementation property, not an ECMAScript guarantee, and needs rechecking after runtime changes.

The first snapshot is borrowed because the Markdown prop already owns it. Equal blocks reuse canonical strings; this can keep that initial backing snapshot alive while an unchanged block survives. Current message text, React's current/alternate trees, initial shared strings and the visible document remain legitimate owners. This is bounded historical-snapshot avoidance, not zero-copy rendering or a promise that no older string ever survives.

The cache owns no subscription, timer, DOM, editor or user draft. Returned block/group arrays remain immutable snapshots, and reset clears its derived references. Stable group and block keys keep interactive code viewers mounted across group completion. The existing code-copy helper also uses `String.fromCharCode.apply` over its existing 16,384-unit chunks, preserving exact text while avoiding spread-iterator work. No runtime dependency, Rust bridge, collector replacement, production GC call or heap flag was added.

## Retainer evidence

Diagnostic snapshots of the actual synthetic 300-paragraph stream show **281 → 3** matching full-reply backing strings, with their summed self sizes **41,535,892 → 572,112 bytes**. The initial 20-paragraph source and latest source buffers still exist in the optimized snapshot. These counts concern matching fixture strings, not total retained size or an exact whole-app saving.

The old snapshot is from the frozen b85d235 production UI; the final comparisons below use a freshly built 493657d reference with the same current search styling/config/dependencies. Markdown is identical at those two reference revisions. The optimized snapshot uses the final production Markdown implementation. Raw heap files stay outside the repository; [before](markdown-before-retainers.txt) and [after](markdown-after-retainers.txt) reports preserve a strong path and self-size summary. `python3 scripts/performance/markdown-heap.py <fixture.heapsnapshot>` reproduces the analysis; V8 truncates long snapshot names, so it uses node `self_size` rather than name length.

Relevant primary source sections were inspected in [V8's string layout](https://github.com/v8/v8/blob/main/src/objects/string.tq) and [substring allocation](https://github.com/v8/v8/blob/main/src/heap/factory.cc): sliced strings have parent/offset fields, and the allocator can retain a parent instead of copying a substring. This extends the previously read GC/reachability and derived-state chapters recorded in the main research inventory; no additional whole-book reading is claimed here.

## Standalone CPU tradeoffs

[CPU results](markdown-cpu.json) contain three alternating fresh Node pairs per scenario, one whole-workload warmup and three timed passes per child. Input construction/materialization and exact differential validation are outside timing; splitting, cache/group creation and output consumption are inside. Medians are within child then across children. Natural GC observations are descriptive; no forced GC is used in this microbenchmark.

| Workload | Inputs per timed pass | Legacy splitter | Incremental groups |
| --- | ---: | ---: | ---: |
| Append to tail after 300 completed paragraphs | 200 | 88.760 ms | 42.768 ms |
| Append new paragraphs | 200 | 116.335 ms | 45.440 ms |
| Append lines inside an open fence | 200 | 8.879 ms | 1.679 ms |
| Reference-definition whole-document fallback | 200 | 0.068 ms | 0.266 ms |
| Edit the first paragraph | 200 | 108.062 ms | 108.766 ms |
| Independent cold large reply | 100 | 40.612 ms | 50.624 ms |
| Independent cold short reply | 10,000 | 0.814 ms | 5.179 ms |

Cold setup and fallback cases have overhead: approximately 0.100 ms per cold large reply and 0.00044 ms per cold short reply in this run. These are splitter/grouping costs, not whole-message render/paint times. Prefix verification still reads the old prefix with `startsWith`; long unfinished blocks still need materialization/parsing. There is no general O(new bytes) or app-wide speed claim. The [earlier prototype audit](markdown-cpu-exploratory.json) is retained separately; it exposed expensive cold/edit copying and unnecessary prefix validation for whole-reference fallback, which were corrected before final measurement.

## Native comparisons and verification

The [final native comparisons](markdown-pairs.json) contain three alternating fresh pairs for each workload: 18 Electron processes and 180 complete app-process-tree samples. Each boundary has five samples after diagnostic renderer GC; the table uses medians within process and then across three processes. Each streamed input is observed committed before the next update, so transport coalescing cannot hide historical snapshots. The exact ordered paragraph texts and the first paragraph's DOM identity match in every run. Inter-paragraph newline DOM nodes differ between one whole Markdown tree and separate blocks; the text comparison deliberately preserves each paragraph's content without confusing those nodes with missing data.

| Settled final workload | Renderer JS heap, before → after | App-process-tree PSS, before → after | DOM nodes, both |
| --- | ---: | ---: | ---: |
| Stream 20 → 300 one-line paragraphs; 280 observed updates, 277,278 UTF-16 units | 48.93 → 10.37 MiB | 427.73 → 385.38 MiB | 1,186 |
| Cold 300-paragraph reply | 7.58 → 7.54 MiB | 348.06 → 348.36 MiB | 1,186 |
| Short reply, 1 → 12 paragraphs | 8.116 → 8.131 MiB | 350.84 → 339.84 MiB | 621 |

Within-pair final PSS differences (after minus before) are **−42.95, −40.97, −40.21 MiB** for the stream; **+0.292, +0.338, +1.834 MiB** cold; and **−10.13, −19.79, −1.27 MiB** short. The stream's median paired difference is −40.97 MiB, distinct from its −42.35 MiB difference of independent medians. Short-case JS heap changes are only +11–20 KiB, so its much larger PSS variation is not attributed to a feature saving. Cold controls are near-flat in JS heap, not proof of equivalence. The retained-heap and actual strong-path evidence support the streamed-snapshot improvement; no significance test or confidence interval is claimed.

PSS apportions shared pages; summed RSS would double-count sharing. Every sample's process-tree accounting completed. Xvfb, external display/driver allocations, model services, CLI wrapper parents and detached/reparented helpers outside the Electron tree are excluded. These are settled post-diagnostic-GC boundaries, not natural peaks, ordinary collector pauses, startup or whole-app throughput.

The separate [bundle audit](markdown-bundles.json) adds **3,257 minified bytes / 1,197 gzip bytes** to the complete cold-chat static JS closure and 3,257 bytes to total shipped JS. It compares isolated builds with only the old Markdown/copy helper restored to 493657d. Both chat closures still exclude CodeMirror and the lazy code viewport. The added grouping/cache code has a real byte cost; no startup-speed or smaller-download claim follows from it.

The native functional fixture verifies a real 1,100-line code viewer at block 63, then appends across the 64/128/192-block boundaries. The same viewer, full document, document selection, Find query and Find-input selection survive. The separate existing native code-viewer run passes all 12 checks, including offscreen collection, full copy, browser-find/plain-text access, streaming restoration, wrapping and ANSI transitions. The paused actual grammar-import probe still proves cancelled highlighter owners release and an independent consumer highlights when the import resumes.

All **587** regression tests, TypeScript, production UI build and VS Code bundle build pass. Tests include exact output comparisons for every prefix of fence/list/reference/CRLF/Unicode samples, 3,000 deterministic append/edit/rewind/threshold operations, immutable prior snapshots, group identities and rendered HTML. Linux Electron fixtures use temporary profiles/projects and invoke no provider. Windows/macOS native windows and installers are not tested here.

An exploratory native comparison wrote its fifth complete child result, then stalled in ordinary headless `app.quit`; the parent deadline terminated it. That [interrupted set](markdown-exploratory-pairs.json) remains separate and supplies no aggregate claim. A [second incomplete set](markdown-whitespace-audit.json) passed stream/cold checks but exposed the short-case root-text whitespace assertion described above. The fixture now compares ordered paragraph text and explicitly exits only its disposable process after writing completed results; the full final set was rerun. Ordinary app shutdown is outside this fixture's scope.

Full conversation-body virtualization, all React/store owners, dirty-document/undo working-set budgets, natural peak/GC pauses, application startup and real local-model RAM/VRAM remain separate work. Improvements here are not additive to prior workload savings and do not complete the broader memory objective.
