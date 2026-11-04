# Memory optimization: research, implementation and evidence

Research checked 4 November 2026. This is an ongoing engineering record, not a claim that every memory technique or every book has been exhausted. Published v0.1.3 and the current working tree are different states. A successful benchmark is not proof of a released installer or of lower total application RAM.

## What is being optimized

| Cost | Measurement | Separate from |
| --- | --- | --- |
| JavaScript retained objects | Heap after a defined workload and settling period; snapshots/retainer paths when necessary | RSS, external buffers, GPU processes |
| Transient allocations | Serialized row/byte counts, heap trend, natural GC events/time | Long-term cache retention |
| Main-process blocking | Duration and distribution of persistence and other synchronous work | Provider generation latency |
| Renderer work | Loaded module graph, interaction timing, mounted components, DOM size | Total installer size |
| Native/process memory | Per-process RSS/working set and platform-specific accounting | JavaScript heap alone; summed RSS may double-count shared pages |
| Local inference memory | Runtime-reported loaded models, weight format, context/KV cache and active requests | Tributary UI memory and character-based prompt budgets |

No arbitrary `--max-old-space-size`, forced production `global.gc()`, periodic cache-clearing timer or automatic model unload has been added. The first two measured changes reduce work and allocation at the source.

## Books and primary-source reading

The scope column is deliberate. A contents page is not a read book; a chapter is not the entire volume. No unavailable full text has been claimed as reviewed, and no paid book was downloaded from an unauthorized source.

| Source | Scope reviewed | Application to Tributary |
| --- | --- | --- |
| [The Garbage Collection Handbook, author contents](https://www.gchandbook.org/contents.html) | Public contents: mark/sweep, copying, compaction, reference counting, generations, concurrency, weak references, comparison and experimental methodology. Full book not read. | Organize the algorithm inventory and evaluation criteria. This does not justify replacing V8 or claiming a new collector. |
| [OSTEP, chapter 22: Beyond Physical Memory—Policies](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf) | Official free chapter; cache-management and FIFO/LRU replacement sections reviewed. | Working-set and replacement-policy reasoning. Application-level eviction still requires ownership and dirty-data rules; OS paging examples are not a direct prescription for editor state. |
| [Richard Fabian, Data-Oriented Design: Optimisations](https://www.dataorienteddesign.com/dodbook/node9.html) | Official reduced online edition, optimization/measurement and data-movement discussion. | Measure specific transformations; avoid repeatedly materializing unchanged history. |
| [Data-Oriented Design: Helping the compiler](https://www.dataorienteddesign.com/dodbook/node10.html) | Reduced online edition, memory-dependency, cache utilization and aliasing sections. | Evaluate contiguous data/typed arrays for measured dense workloads. Native-language examples do not prove that rewriting object-rich UI state is beneficial. |
| [The Rust Programming Language: What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) | Official ownership chapter introduction, stack/heap and resource lifetime sections. | Explicit ownership helps design cleanup. A Rust bridge must still account for boundary copies, native buffers and JS references. It cannot collect reachable React state. |
| [V8: Orinoco garbage collector](https://v8.dev/blog/trash-talk) | Reachability, generations, major/minor collection and parallel/concurrent collection explanation. This is a 2019 architecture explanation, not a promise of identical internals in every Electron version. | Reduce allocation and live-object retention instead of forcing collections. |
| [Node: tracing garbage collection](https://nodejs.org/learn/diagnostics/memory/using-gc-traces) | GC diagnostics and observation methods. | The streaming benchmark records natural GC entries using `PerformanceObserver`. |
| [Electron: performance](https://www.electronjs.org/docs/latest/tutorial/performance) | Profiling, loading only needed code and blocking-work guidance. | Measure the actual processes and defer optional UI modules. |
| [React: lazy](https://react.dev/reference/react/lazy) | Lazy module caching, module-level declaration, Suspense and Error Boundary behavior. | Lazy declarations stay outside components; closing a loaded surface preserves its mounted state. |
| [Node: backpressure](https://nodejs.org/learn/modules/backpressuring-in-streams) | Stream flow-control guidance. | Audit producer/consumer queues and respect drain signals instead of assuming a bounded visible output bounds buffered input. |
| [SQLite PRAGMA reference](https://sqlite.org/pragma.html#pragma_cache_size) | Official configuration reference. | Profile native cache behavior before changing cache or mapping settings; retain safe transactions and existing WAL behavior. |
| [Ollama FAQ](https://docs.ollama.com/faq) | Context configuration and runtime-loaded model reporting. | Runtime memory is a separate control plane. Character budgets are not token counts or model-weight limits. |

## Technique inventory and current decision

“Existing” means source inspected, not a new improvement demonstrated by this pass. “Open” means incomplete; no speedup or memory reduction is claimed for it.

| Approach | State | Owner / evidence / next requirement |
| --- | --- | --- |
| Incremental persistence / avoid repeated serialization | Implemented and measured | `core/store.js`: optional message ID dirty scope; Hub, manager and delegation publish only their changed message. Wider saves dominate narrower batches. |
| Batching/coalescing | Existing | SQLite save debounce and desktop event coalescing. Keep final flush and approval delivery immediate. |
| Delta transfer / structural sharing | Existing | `core/message-patch.js` and renderer patch reconstruction tests. Missing bases still require a full snapshot. |
| Lazy history loading | Existing | SQLite lazy `messages` getter; metadata/status queries do not hydrate whole conversations. Opened conversations still remain resident. |
| Compact status projections | Existing and separately measured | Sidebar summaries retain flags, not replies, logs, images or diffs. See `performance/memory-summary-benchmark.json`. |
| Code splitting / conditional imports | Implemented and measured | Settings, team, room and saved-document surfaces; editor engine deferred separately from read-only file/memory preview. Complete static dependency closures measured, not just the largest chunk. |
| Tree shaking / production minification | Existing build pipeline | Vite production build. All supported features remain packaged; splitting slightly increases total JS rather than making optional code disappear. |
| Draft/session lifetime ownership | Preserved for deferred surfaces | Keep loaded components mounted after close. Terminal sessions and unsaved file/document drafts are not disposable caches. Failed surfaces can close without blanking the workbench. |
| Bounded context / streaming text and tool output limits | Existing | Handoff, memory retrieval, direct response limits and local agent complete-tool-group trimming. The persistent original history is preserved. |
| Model quantization / smaller weights / KV cache sizing | Runtime-owned; further work open | Unsloth/Ollama/LM Studio own inference. Need real runtime/hardware tests, supported API contracts and active-request ownership before promising savings. |
| Model unload / idle policy / concurrency limits | Further work open | Do not stop a model used by another chat/application. Need request accounting and runtime capability checks. |
| Weighted LRU / TTL for clean UI resources | Open | `workspace-panel.tsx` retains visited project file surfaces; `document-panel.tsx` retains visited documents. Define dirty/current/running pins before eviction; measure revisit cost and retained size. |
| Evicting inactive loaded backend histories | Open | `SqliteStore` message arrays and fingerprints stay loaded after opening. Must pin in-flight turns, external-writer reconciliation and callers holding thread/message references. Never replace a live array underneath a writer. |
| Virtualizing long transcripts / trees | Open for workload validation | Measure DOM growth, scrolling, selection, find, screen-reader access and follow-agent behavior. Limiting visible rows alone does not reduce backend history. |
| Backpressure / bounded pending queues | Open audit | Trace agent stdout, IPC patch recovery, terminal queues, preview traffic and pending permissions. Visible-output truncation is not producer flow control. |
| Listener/timer/worker/PTY cleanup | Open repeated-cycle verification | Retain active terminals and pending approvals intentionally; require listener/handle counts to settle after actual close/disposal. |
| Weak references / finalizers | No correctness-critical use proposed | GC timing is not a cleanup contract. Use explicit disposal for watchers, subprocesses and worker ownership. |
| Object pooling / arenas / region allocation | Conditional, not implemented | Pools can retain high-water memory. Consider a bounded parser scratch region only after allocation profiles show a hotspot; never pool arbitrary chat objects by default. |
| Typed arrays / structure of arrays / compact IDs | Conditional | Suitable for dense indexes or numeric metadata, not a blanket rewrite of variable-length messages. Measure conversion and boundary costs. |
| Zero-copy / transferable buffers / shared memory | Conditional | Require clear ownership, bounds and cancellation. Moving work into a worker can duplicate large strings if messages are cloned. |
| Memory mapping / native page-cache tuning | Conditional | SQLite already provides native persistence. Map/cap changes need page-fault, RSS and I/O measurements; mapping a large file is not automatically less memory. |
| Native Rust/Zig helper, SIMD or parser acceleration | Conditional | Only promote measured CPU/data-layout hotspots. Compare bridge overhead, startup, total process memory, security surface and all supported platform builds. No native bridge added in this pass. |
| Mark/sweep, copying, compaction, reference counting, generational and concurrent GC | Runtime responsibility | These are alternatives/tradeoffs in memory management, not features to stack inside an Electron app. V8 chooses and implements its collector. |

## Measured persistence result

Recorded in [stream-store-benchmark.json](performance/stream-store-benchmark.json), standalone Node v24.21.0/Linux x64. Each mode uses a separate process, 8 warmups and 40 measured persisted updates. Inputs are reset between modes. The previous mode requests thread-wide comparison; the optimized mode requests only the active message. Both use the current SQLite implementation. This isolates API scope rather than comparing historical binaries.

| Messages in the conversation | Thread-wide median | Message-scoped median | Median ratio |
| ---: | ---: | ---: | ---: |
| 500 | 3.564 ms | 0.287 ms | 12.418× |
| 2,500 | 31.090 ms | 1.582 ms | 19.652× |
| 10,000 | 61.931 ms | 5.287 ms | 11.714× |

For 10,000 messages, instrumented message JSON across the 40 batches fell from 1,075,077,305 bytes to 29,225 bytes. Those are cumulative transient serialization bytes, not retained RAM. Observed natural GC time in that run fell from 370.252 ms to 1.727 ms. Single-run GC timing and sampled heap/RSS are noisy; they are not an end-to-end latency or whole-app RAM guarantee. The active message and history count persisted identically. Tests additionally cover deletion, concurrent external writes, broad dirty-scope promotion and failed-transaction retry.

The remaining scans over IDs/fingerprints still scale with loaded history. This change removes repeated JSON materialization, not every O(n) operation.

## Measured module-loading result

[bundle-benchmark.json](performance/bundle-benchmark.json) compares production builds with identical installed dependencies/config. The baseline restores the App/files/memory import boundaries from `bc0a582`; the report names the sources included in its fingerprint. Each scenario recursively follows all static JS imports.

Cold chat loads about **11.7% less minified JavaScript**; file preview about **31.5% less**. Opening an editor or Settings loads its deferred dependencies at that point. All chunks remain distributed. These numbers do not measure startup time, parse time, total app RAM, download time, model speed or package-size savings. Live desktop interaction checks must accompany the graph assertions.

“File preview” here means the workspace's static dependency closure for a rendered read-only preview, such as README Markdown. Opening an editable JavaScript/TypeScript source requests the deferred editor chunk as expected; it is not covered by the smaller preview-only byte count.

The [desktop interaction record](performance/deferred-ui-verification.json) covers the first opens, team draft retention and changed-chat seeding, real file saving, document draft guard, terminal session continuity, room setup and a deliberately blocked Settings module. The failed feature closed without removing the chat draft; removing the test route and reloading restored normal Settings behavior. Tests used a disposable Linux profile on a virtual display, without provider requests. The full regression suite passed 388 tests; TypeScript and the production UI build passed. These are functional checks, not a total-memory benchmark.

## Remaining verification and implementation work

1. Extend the recorded Linux desktop checks to packaged builds and automated repeated-cycle retention measurements. Keep functional checks separate from bundle-size and memory evidence.
2. Measure repeated chat/project/document switching with heap retainers and process memory, then implement safe clean-cache/history eviction with explicit pins. Preserve dirty drafts, running turns, approvals and external writes.
3. Audit queues, workers and watcher lifetimes under long outputs, cancellation, network loss and repeated open/close cycles. Benchmark the identified hot paths rather than adding unconditional pooling or GC calls.
4. Measure local runtime weights/context/concurrency on actual available hardware. Keep provider generation time and VRAM separate from UI costs.
5. Repeat relevant checks in packaged Linux, Windows and macOS builds before making cross-platform performance claims. A local production build is not installer or release verification.

The older [native bridge investigation](PERFORMANCE_ARCHITECTURE.md) preserves historical observations/proposals. It is not an up-to-date checklist of missing features.
