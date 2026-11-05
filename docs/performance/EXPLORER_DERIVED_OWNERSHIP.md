# Explorer derived-data ownership

Filename lists, compact-folder chains, filename-filter projections and outline rows are derived data. The current folder context keeps its index warm, including during Files/Memory switching. Other contexts release those cached contents. Filter text, expanded folders, page-count intent, outline expansion/scroll, dirty document state and pending operations keep their existing owners. Returning reconstructs the index from actual disk/Git state; hidden outlines stop scheduling parses and abort their current request. Compact-folder maps are not built when compaction is disabled. Hidden find-file listeners are unregistered.

## Why clearing state alone was insufficient

An exploratory state-only cleanup removed hidden outline DOM but did not reduce retained heap after repeated navigation. The isolated heap snapshot had strong paths from event listeners and editor/context-menu effect cleanups through older FolderFiles render activations to filename arrays. The [extracted paths](explorer-derived-retainers.json) demonstrate those references; they are not retained-size attribution or a claim about every React callback.

The final implementation stores large contents behind one stable `createExplorerIndex` owner. Old activation scopes can retain the small owner while `release()` clears its mutable contents and invalidates request epochs. Rendering/effects access that owner rather than keeping filename arrays and chain maps in long-lived render locals. A [separate heap investigation](explorer-derived-heap-counts.json) found 12 filename-sized backing arrays in the unsuccessful, unshipped state-only prototype and one in the final owner version. This is a diagnostic prototype comparison, not the published performance baseline. Full heaps remain temporary; only counts/hashes and reference-path extracts are recorded.

List and search requests have independent sequence numbers and a shared lifetime epoch. Superseded replies and replies from a released lifetime cannot overwrite the current index. Both timer dispatch and response acceptance check current ownership. A queued debounce cannot start a search after a cold render merely because effect cleanup has not run yet. In-flight host Git/search work may still finish; this does not introduce host-process cancellation or a new collector.

## Repeated measurements

[Raw pairs](explorer-derived-pairs.json). Baseline: frozen `2f636de` desktop/UI, with the same current core and fixture in both modes. Three alternating fresh Linux Electron pairs, five post-diagnostic-renderer-GC samples per phase; medians within a process, then across three processes. No other tests/benchmarks ran concurrently. Source fingerprints are checked before/after. Optional heap snapshots were disabled in these measured pairs.

Each of six actual Git indexes has 20,000 paths: 19,999 tracked paths absent from the working tree, plus one real 300-function TypeScript file. This isolates a large filename/compaction graph with real Git traversal and real language-worker outlines; it does not represent rendering 20,000 physical files per project.

| Phase | Retained renderer heap, MiB | Process-tree PSS, MiB | DOM nodes |
| --- | --- | --- | --- |
| six-indexes-and-outlines | 63.01 → 27.38 | 457.14 → 407.24 | 20,223 → 6,148 |
| after-one-return-pass | 63.84 → 27.32 | 472.54 → 433.34 | 20,919 → 6,148 |
| after-three-return-passes | 64.22 → 27.77 | 500.04 → 450.20 | 20,919 → 6,148 |

Outline rows are 1,800 → 300. The restore workload performs 18 Git list calls in each mode; the returned index and its compact-folder map are rebuilt after cold release. Median time to the selected header/editor was 437 → 307 ms, including a fixed 150 ms settling delay. This is not complete index/outline readiness latency or a general speedup. The record measures post-GC retained heap and non-atomic Linux process-tree PSS/private pages, not natural peak RAM, allocator fragmentation, model/VRAM memory, packaged builds or cross-platform behavior. Production does not force GC. Do not add this saving to earlier reports: the workloads and baselines differ.

## Verification and boundaries

All three changed runs check exact dirty text, restored outline expansion and scroll, preserved filter text, cancelled hidden debounce, a held older Git-index reply released after a newer index, and an outline request released after hiding followed by a fresh outline on return. The latter request may target a terminated worker; it is not proof that a stale response was delivered to a still-running worker. The existing worker-client tests cover obsolete response identities separately.

Unit checks cover the stable-owner boundary, empty-search reset without erasing local filename projections, hidden-file filtering, compaction reuse/disable, and obsolete list/search tokens. Full suite: 559 passed; TypeScript, UI production and extension builds pass. A separate native regression retained previous multi-root expansion/scroll, file-creation draft and delayed actual writes, dirty text and external additions. Its memory samples ran alongside regression work and are excluded from performance claims.

Remaining work includes active-tree virtualization, cold/durable document and undo working sets, older store/prop snapshots retained by callbacks, peak allocation/GC behavior, and streaming the host filename producer. Current retained index contents are bounded by the existing list/search limits, but all remaining editor/project owners are not globally budgeted. No provider or local inference service was invoked by these fixtures.

Reproduce: `npm run bench:explorer-derived -- /absolute/frozen-baseline-host /absolute/report.json`. The baseline host needs matching desktop/UI/dependencies. Failure evidence remains in the printed temporary directory.
