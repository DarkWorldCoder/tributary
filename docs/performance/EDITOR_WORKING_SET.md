# Editor allocation, natural collection and working set

This phase removes repeated serialization and temporary line arrays during local typing and live file updates. It preserves the complete source, CodeMirror undo history, cursor/scroll mapping, indentation inference and existing formatting hints. It adds no runtime dependency, heap flag, production forced collection or native bridge.

## Ownership and implementation

The parent already owns the complete current text for drafts and persistence. Each live editor now aliases that value with the corresponding immutable CodeMirror `Text` identity. Local `ChangeSet` offsets reuse unchanged ranges and materialize inserted text, producing one sequential canonical string instead of serializing every unchanged line. An exact parent echo skips the former second serialization and diff. Incoming file updates reuse the known previous string and share one minimal change with the remote-update helper. A stale or CR-bearing raw value falls back to normal CodeMirror serialization; teardown clears the alias. There is no snapshot-history cache.

The single-result-string case deliberately joins two nonempty pieces: the pinned upstream V8 source returns the original string for a one-element join, which can otherwise retain a larger backing string after deletion. This is runtime-specific implementation evidence, not an ECMAScript guarantee for future engines. The actual current runtime is recorded in every native report.

Indentation and formatting-hint scans keep the same bounded source prefix and priorities without arrays for every line. Changed-line highlights use CodeMirror's existing line index and scan only inserted newlines. The formatter itself and original source layout are unchanged. Independent differential oracles retain the old algorithms and cover Unicode whitespace, line/prefix boundaries, multi-line try/catch, long-line priority, multi-edit changes, surrogate code units and composed change sets.

## Three separate measurements

The [paired report](editor-working-set.json) compares frozen `ea94d4b` with the allocation implementation committed as `d03db47`. For each mode/workload there are three serial fresh-app pairs; the middle pair reverses order. The same pinned dependencies and complete UI build hashes are recorded. Sources and both production builds are checked after each case. No tests, builds or other agent-launched benchmarks run during the cohort.

- **Allocation attribution:** 32 KiB statistical renderer heap sampling plus CPU samples. Both minor- and major-collected objects are included. Exclusive stack-node weights are summed once. Reading the sampled profile forces diagnostic GC in the pinned V8 implementation, so these runs supply neither ordinary RAM nor natural-collection results.
- **Natural trace:** separate apps use only Electron `contentTracing`, with renderer-main-thread work markers and V8/DevTools categories. No debugger, heap/CPU profiler or explicit GC runs. All trace buffers must remain below 80% usage, and observable-pause pairs must be complete. Tracing still adds overhead. Event durations are not universal exact stop-the-world latency.
- **Ordinary RAM:** separate apps have no debugger, profiler, tracer or explicit GC. A parent samples Linux process-tree PSS at a requested 100 ms interval, accepting only complete accounting. Work-only peaks, work plus two seconds of settling, and final medians are separate. Correctness checks occur afterward and are excluded. Sampled maxima are not continuous peaks.

The tracked TypeScript fixture contains either 40 or 40,000 lines. Grammar parsing through EOF completes before work. Local work is 60 real CodeMirror dispatches; remote work is 32 actual writes observed through the real file watcher. Both use an 80 ms gap. This measures repeated edits to a warmed open document, not cold parsing, arbitrary typing patterns, paint or all language servers. Exact final text and native-key undo/redo are required in every app. All measured app-main PIDs must be absent after teardown.

PSS apportions shared pages instead of double-counting RSS. It excludes the sampler, Xvfb, external services and allocations outside app descendants. Source Linux desktop behavior does not certify installed Windows/macOS, GPU/VRAM or provider performance.

## Results

All 48 apps pass exact final text and native-key undo/redo, use tracked files and fully warmed grammar, and exit before the next app starts. All source/build fingerprint checks pass. The ordinary-memory cases contain **1,651 complete samples and 61 rejected attempts**. Rejected observations remain in the [raw diagnostic archive](editor-working-set.diagnostics.json.gz); they are not included as incomplete totals. No final case is omitted or retried.

Medians of three fresh pairs, with MiB = 1,048,576 bytes:

| Large-document measurement | Baseline | Optimized |
| --- | ---: | ---: |
| Typing: sampled allocation estimate | 353.53 MiB | 94.66 MiB |
| Live file updates: sampled allocation estimate | 246.04 MiB | 75.96 MiB |
| Typing: work-only app-tree PSS peak | 443.68 MiB | 425.25 MiB |
| Live updates: work-only app-tree PSS peak | 437.75 MiB | 422.27 MiB |
| Typing: work plus settling PSS peak | 443.68 MiB | 428.25 MiB |
| Live updates: work plus settling PSS peak | 437.99 MiB | 422.44 MiB |
| Typing: settled app-tree PSS | 432.08 MiB | 427.60 MiB |
| Live updates: settled app-tree PSS | 436.70 MiB | 421.09 MiB |

Allocation estimates decrease 73.23% for typing and 69.13% for live updates. Ordinary work-peak PSS decreases in all three large-file pairs: typing differences are −19.37, −21.85 and −13.97 MiB; live updates are −8.90, −15.48 and −24.54 MiB. Work-plus-settling differences are −19.37/−17.67/−12.60 MiB and −8.90/−15.55/−24.82 MiB respectively. These are descriptive observations, not a promise of constant RAM or universal savings.

Starting PSS also varies: typing pre-work medians are 392.20 → 389.77 MiB, and remote pre-work medians are 397.14 → 391.47 MiB. Therefore the absolute peak differences must not all be attributed to allocations made during work. Peak-minus-pre-work growth medians are 51.48 → 35.48 MiB for typing and 40.62 → 29.66 MiB for live updates. Within-pair growth differences are −19.65/−20.86/−7.57 MiB and −0.17/−10.96/−21.23 MiB. Final retained-RAM differences also vary; reduced allocation traffic does not guarantee a proportional resident-memory decrease.

Small-file controls remain mixed. Work-peak PSS medians are 378.92 → 377.99 MiB for typing and 390.81 → 387.28 MiB for live updates, but the within-pair differences are −0.93/+1.45/−0.33 MiB and −3.53/+2.60/+2.14 MiB. These controls do not establish a small-file RAM improvement.

### Natural renderer collection events

| Large-document work-window trace metric | Typing baseline → optimized | Live updates baseline → optimized |
| --- | ---: | ---: |
| Main-thread GC events | 12 → 4 | 10 → 5 |
| Minor collections | 11 → 3 | 8 → 3 |
| Major collections | 1 → 1 | 2 → 2 |
| Sum of GC event durations | 34.31 → 14.76 ms | 30.27 → 18.97 ms |
| Sum of V8 ObservablePause durations | 32.71 → 14.24 ms | 28.92 → 18.16 ms |
| Per-run ObservablePause p95 | 8.75 → 8.93 ms | 7.63 → 6.32 ms |

Collection counts and aggregate event durations are lower in each large-file pair, driven by fewer minor collections. Major collection counts are unchanged. **Typing's median p95 pause is slightly worse**, and two of its three p95 paired differences increase. This does not establish universally lower worst-case collector latency. All raw traces and per-pair differences are retained.

Ordinary local synchronous-dispatch p95 medians are 10.70 → 10.60 ms for the large case and 4.80 → 4.90 ms for the small case. Traced large-case dispatch p95 is 10.70 → 11.70 ms. Completion intervals contain intentional gaps and polling. These results support less allocation/temporary working set, not a universal responsiveness, throughput or paint claim.

### Bundle cost

The [clean build-only audit](editor-working-set-bundles.json) adds **zero uncompressed JavaScript bytes** to the cold-chat static closure; its separately compressed emitted chunks differ by +2 bytes, including changed import hashes. The editor closure adds 1,270 minified / 482 gzip bytes, and total shipped JavaScript adds 1,260 bytes. Optional CodeMirror, read-only viewer and local-model setup remain outside cold chat. Both audit outputs use temporary folders and leave the measured production build intact.

[Native large-file view](editor-working-set.png). This screenshot shows the actual tracked fixture and editor; exact offscreen content is verified separately by assertions.

## Reading and reproducibility

[Reading provenance](editor-working-set-reading.json) records the complete extracted text of author-hosted OSTEP chapter 13, including its listing, references and homework prompts. Rendered diagrams and homework experiments were not inspected/executed. Virtual address space, language allocation traffic and physical process memory remain distinct. The whole book and linked papers were not read.

Targeted upstream V8 `15.2.124.37` source covers sequential string joining, sampling flags/profile retrieval and observable-pause scopes. Electron `v44.7.2` tracing documentation and installed CodeMirror `6.13.1` change-set APIs were read selectively. Upstream tagged source is not byte-for-byte certification of Electron's patched V8 binary. The implementation follows the previously documented Dirty Flag principle by skipping exact echoes; the native measurements establish this phase's effects independently.

Reproduction requires Linux procfs, Xvfb, installed dependencies and a built UI. Create a frozen baseline host with `desktop`, `ui/src`, `ui/dist`, package metadata and unchanged core/dependency links, plus `baseline.json` naming the baseline commit. Then run:

```sh
node scripts/performance/editor-working-set.cjs /absolute/baseline-host /tmp/editor-working-set.json
node scripts/performance/editor-bundles.mjs ea94d4b /tmp/editor-bundles.json
```

The baseline host must actually contain the baseline production build; changing sources/builds while the cohort runs invalidates the comparison. The driver preserves its diagnostic directory on failure and removes it only after a complete report and compressed raw-data archive are written. The raw companion archive retains allocation/CPU profiles, full traces, every accepted process sample and every rejected attempt. Exploratory earlier runs do not contribute final medians.

## Remaining scope

This reduces temporary work, not the semantic size of source text or its undo history. Durable dirty/undo budgets, long lifetime cycles, complete metadata virtualization, wider workloads, other runtime/OS variants and GPU memory remain open under the original objective. No claim is made that all books were read or the overall optimization goal is complete.

## Validation boundary

All **619 regressions**, TypeScript and the production UI build pass. The extension builds through the regression suite's pretest. Native checks pass [agent control (6 groups)](editor-working-set-agent.json), [split editors (16 groups)](editor-working-set-split.json) and [search (15 groups)](editor-working-set-search.json), with code hashes matching this phase. The first full-suite shell was interrupted (exit 143); its partial output is not counted as success. The completed repeat passed all cases. [Verification record](editor-working-set-verification.json).

An additional native CRLF/Unicode probe then exposed a pre-existing blank-line duplication bug, reproduced in both the frozen baseline and optimized builds. That failure is retained in the verification record and does not contribute a passing claim. The measured cohort uses LF fixtures; the subsequent line-ending correction must be validated separately and is outside these frozen timing/RAM numbers.

### Separate line-ending correction

The follow-up normalizes CRLF/CR text to CodeMirror's existing LF representation **before** calculating replacements. Otherwise an unchanged LF suffix can remain while an inserted CR is independently normalized into another LF. Live updates, direct agent-revert updates and parked documents now share that boundary. An equivalent raw CRLF revision is a no-op; actual revisions keep normal undo boundaries. This does not introduce automatic source formatting or promise disk-EOL preservation beyond the editor's existing save behavior.

The final corrected build passes **621 regressions**, 11 focused cases, TypeScript, production UI/extension builds and **38 grouped native checks**: agent control 7, split editor 16, search 15. The added native check opens CRLF/Unicode source, performs multiple edits, observes the parent echo, saves exact text, applies a real CRLF disk update, types again and undoes. Parked-state tests independently preserve identity, text and undo/redo. The [follow-up verification](editor-crlf-verification.json), [agent checks](editor-crlf-agent.json), [split checks](editor-crlf-split.json), [search checks](editor-crlf-search.json) and [inspected screenshot](editor-crlf-agent.png) retain this separate evidence. The earlier failure remains recorded. These are Linux source-build checks; the follow-up adds no new timing/RAM claim for its changed build.
