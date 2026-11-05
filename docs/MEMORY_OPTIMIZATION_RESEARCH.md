# Memory optimization: research, implementation and evidence

Research checked 5 November 2026. This is an ongoing engineering record, not a claim that every memory technique or every book has been exhausted. Published v0.1.4 and the current working tree are different states. A successful benchmark is not proof of a released installer or of lower total application RAM.

## What is being optimized

| Cost | Measurement | Separate from |
| --- | --- | --- |
| JavaScript retained objects | Heap after a defined workload and settling period; snapshots/retainer paths when necessary | RSS, external buffers, GPU processes |
| Transient allocations | Serialized row/byte counts, heap trend, natural GC events/time | Long-term cache retention |
| Main-process blocking | Duration and distribution of persistence and other synchronous work | Provider generation latency |
| Renderer work | Loaded module graph, interaction timing, mounted components, DOM size | Total installer size |
| Native/process memory | Per-process RSS/working set and platform-specific accounting | JavaScript heap alone; summed RSS may double-count shared pages |
| Local inference memory | Runtime-reported loaded models, weight format, context/KV cache and active requests | Tributary UI memory and character-based prompt budgets |

No arbitrary `--max-old-space-size`, forced production `global.gc()`, periodic cache-clearing timer or automatic model unload has been added. Measured changes reduce work and allocation at the source; each result below keeps its own verification scope.

## Books and primary-source reading

The scope column is deliberate. A contents page is not a read book; a chapter is not the entire volume. No unavailable full text has been claimed as reviewed, and no paid book was downloaded from an unauthorized source.

| Source | Scope reviewed | Application to Tributary |
| --- | --- | --- |
| [The Garbage Collection Handbook, author contents](https://www.gchandbook.org/contents.html) | Public contents: mark/sweep, copying, compaction, reference counting, generations, concurrency, weak references, comparison and experimental methodology. Full book not read. | Organize the algorithm inventory and evaluation criteria. This does not justify replacing V8 or claiming a new collector. |
| [OSTEP, chapter 17: Free-Space Management](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-freespace.pdf) | Full author-hosted 18-page chapter read, including allocator mechanisms, fit policies, segregated/slab and buddy approaches, references and simulation questions. Simulation exercises were not run; this is not the whole book. | Distinguish live allocations from allocator capacity and fragmentation; evaluate pooling/size classes against actual workloads and retained capacity. This does not justify replacing the runtime allocator. |
| [OSTEP, chapter 22: Beyond Physical Memory—Policies](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf) | Full author-hosted 18-page chapter read, including OPT/FIFO/random/LRU/clock, locality and scan behavior, dirty pages, prefetch/write grouping, admission control, references and simulation questions. Exercises were not run; this is not the whole book. | Working-set and replacement-policy reasoning. Application-level eviction still requires ownership and dirty-data rules; OS paging examples are not a direct prescription for editor state. |
| [OSTEP, chapter 33: Event-based Concurrency](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-events.pdf) | Full author-hosted 12-page chapter text read, including select/poll and AIO listings, continuations, multicore/paging caveats, references and homework. Homework was not implemented; this is not the whole book. | Completion needs explicit continuation state. Apply it to receiver acknowledgements and interrupted-delivery ownership; asynchronous submission alone does not establish receiver completion. |
| [Richard Fabian, Data-Oriented Design: Optimisations](https://www.dataorienteddesign.com/dodbook/node9.html) | Official reduced online edition, optimization/measurement and data-movement discussion. | Measure specific transformations; avoid repeatedly materializing unchanged history. |
| [Data-Oriented Design: Helping the compiler](https://www.dataorienteddesign.com/dodbook/node10.html) | Reduced online edition, memory-dependency, cache utilization and aliasing sections. | Evaluate contiguous data/typed arrays for measured dense workloads. Native-language examples do not prove that rewriting object-rich UI state is beneficial. |
| [Sedgewick and Wayne, Algorithms 4th Edition: Priority Queues](https://algs4.cs.princeton.edu/24pq/) | Author-hosted textbook companion: API, array/list alternatives, binary heaps, heap repair, practical considerations and heapsort prose; read the page text and inline repair listings. Linked programs, diagrams and exercises were not fully reviewed or executed; this is not the whole book. | Keep a bounded selection from a directory stream. Measure callback/iterator overhead and retain the faster bulk path where a large prefix is needed. |
| [The Rust Programming Language: What Is Ownership?](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html) | Official ownership chapter introduction, stack/heap and resource lifetime sections. | Explicit ownership helps design cleanup. A Rust bridge must still account for boundary copies, native buffers and JS references. It cannot collect reachable React state. |
| [V8: Orinoco garbage collector](https://v8.dev/blog/trash-talk) | Reachability, generations, major/minor collection and parallel/concurrent collection explanation. This is a 2019 architecture explanation, not a promise of identical internals in every Electron version. | Reduce allocation and live-object retention instead of forcing collections. |
| [Node: async context tracking](https://nodejs.org/api/async_context.html) | `AsyncLocalStorage.run`, callback/context-loss guidance, and `disable` cleanup sections, read 4 November 2026. The runtime uses the long-established `run` API, not newer `withScope` features. | Explicit nested operation ownership for histories; independent leases for coalescing/transport and delegated-worker completion. Close disables the tracker; late callbacks cannot reopen a closed cache. |
| [Node: tracing garbage collection](https://nodejs.org/learn/diagnostics/memory/using-gc-traces) | GC diagnostics and observation methods. | The streaming benchmark records natural GC entries using `PerformanceObserver`. |
| [Electron: performance](https://www.electronjs.org/docs/latest/tutorial/performance) | Profiling, loading only needed code and blocking-work guidance. | Measure the actual processes and defer optional UI modules. |
| [React: lazy](https://react.dev/reference/react/lazy) | Lazy module caching, module-level declaration, Suspense and Error Boundary behavior. | Lazy declarations stay outside components; closing a loaded surface preserves its mounted state. |
| [Node: backpressure](https://nodejs.org/learn/modules/backpressuring-in-streams) | Stream flow-control guidance. | Audit producer/consumer queues and respect drain signals instead of assuming a bounded visible output bounds buffered input. |
| [Node: child processes, maxBuffer](https://nodejs.org/api/child_process.html#maxbuffer-and-unicode) | Current official limit and Unicode documentation, read 4 November 2026. Limits apply to stdout or stderr and count bytes. | Apply independent byte limits to SSH command collection too; terminate and report overflow instead of silently accepting an unbounded stderr array. |
| [Node: readable streams](https://nodejs.org/api/stream.html#readablesetencodingencoding) | Current official encoding, data, end, close and destroy documentation. UTF-8 decoding spans transport chunks. | Keep decoding on the actual Readable, frame decoded data without rescanning old prefixes, and release temporary listeners on end/close. Diagnostic tails must be bounded before newline framing. |
| [SQLite PRAGMA reference](https://sqlite.org/pragma.html#pragma_cache_size) | Official configuration reference. | Profile native cache behavior before changing cache or mapping settings; retain safe transactions and existing WAL behavior. |
| [Ollama FAQ](https://docs.ollama.com/faq) | Context configuration, runtime-loaded model reporting and the concurrent-request/queue sections rechecked 4 November 2026. | Runtime memory is a separate control plane. Its documented parallelism/context relationship motivates client admission control, while runtime-reserved cache and weight allocations still require real hardware measurements. |

## Technique inventory and current decision

“Existing” means source inspected, not a new improvement demonstrated by this pass. “Open” means incomplete; no speedup or memory reduction is claimed for it.

| Approach | State | Owner / evidence / next requirement |
| --- | --- | --- |
| Incremental persistence / avoid repeated serialization | Implemented and measured | `core/store.js`: optional message ID dirty scope; Hub, manager and delegation publish only their changed message. Wider saves dominate narrower batches. |
| Batching/coalescing | Existing | SQLite save debounce and desktop event coalescing. Keep final flush and approval delivery immediate. |
| Delta transfer / structural sharing | Existing | `core/message-patch.js` and renderer patch reconstruction tests. Missing bases still require a full snapshot. |
| Non-streaming patch-cache lifetime | Implemented and measured | User/system full messages are delivered normally but never kept as streaming delta bases; explicit role replacement and failed transport forget obsolete bases. Synthetic retained-prompt measurement below. |
| Async message delivery coalescing | Implemented per message, with shared desktop admission | One unresolved delivery plus one latest pending state per message; eight shared desktop slots before snapshot/IPC work. Receiver replacement clears bases and replays full state. Pending-source/byte ceilings, other events and React paint completion remain separate. |
| Lazy history loading / temporary transport snapshots | Implemented and measured | The desktop/extension read-only thread RPC no longer hydrates SQLite writer state. Review acknowledgement uses bounded status summaries. Internal writers still retain live objects and pending changes. |
| Compact status projections | Existing and separately measured | Sidebar summaries retain flags, not replies, logs, images or diffs. See `performance/memory-summary-benchmark.json`. |
| Code splitting / conditional imports | Implemented and measured | Settings, team, room and saved-document surfaces; editor engine deferred separately from read-only file/memory preview. Complete static dependency closures measured, not just the largest chunk. |
| Tree shaking / production minification | Existing build pipeline | Vite production build. All supported features remain packaged; splitting slightly increases total JS rather than making optional code disappear. |
| Draft/session lifetime ownership | Preserved for deferred surfaces | Keep loaded components mounted after close. Terminal sessions and unsaved file/document drafts are not disposable caches. Failed surfaces can close without blanking the workbench. |
| Bounded context / streaming text and tool output limits | Existing | Handoff, memory retrieval, direct response limits and local agent complete-tool-group trimming. The persistent original history is preserved. |
| Linear framing / bounded diagnostic collection | Implemented and measured | `core/proc.js` searches new chunks, joins complete frames, releases listeners and offers a separately bounded stderr tail. Runner/ACP/Codex use it. SSH command stdout and stderr each honor `maxBuffer`. Complete stdout protocol frames remain lossless and may still grow until a delimiter arrives; this is not a universal frame-size or backpressure bound. |
| Model quantization / smaller weights / KV cache sizing | Runtime-owned; isolated CPU context measurements recorded | A pinned native CPU/Qwen fixture measures context and admission separately. Weight/KV quantization comparisons, larger models, GPUs and the named desktop runtimes remain open. |
| Model unload / idle policy / concurrency limits | Client admission implemented and measured against real CPU inference; runtime ownership work open | Built-in direct/local-agent generations share per-service, per-process admission with 1/2/4 limits, cancellation and a bounded wait queue. Native measurements show that idle weights/context remain allocated. Other apps/native CLIs and runtime-global memory remain independently owned. |
| Bounded LSP byte framing | Implemented; dedicated parser and subprocess tests pass; benchmark report records exact scope | Complete bodies are consumed synchronously from their transport chunk; fragmented bodies grow geometrically as bytes arrive, bounded to 8 MiB per frame. Headers are capped at 8 KiB. Dedicated retained buffers avoid pinning a shared pool or a completed large batch. |
| Clean UI resource retention | Partly implemented | Saved-document copies keep only the current entry and unsaved drafts. Visited project file surfaces still need explicit dirty/undo/pending-operation ownership before eviction. |
| Evicting inactive loaded backend histories | Implemented with explicit ownership | Historical views use temporary snapshots. Durable completed writers are released by the owner-aware idle cache; active operations, background turns, transport ownership and unmanaged SDK references remain pinned. See the writer-history report below. |
| Virtualizing long transcripts / trees | Open for workload validation | Measure DOM growth, scrolling, selection, find, screen-reader access and follow-agent behavior. Limiting visible rows alone does not reduce backend history. |
| Backpressure / bounded pending queues | Partly implemented | Desktop terminals now acknowledge contiguous parsed output, bound in-flight characters and packet count, and pause/resume the real PTY. Local generations also have bounded admission. Agent stdout/IPC patch recovery, other preview traffic and permission queues remain open; visible truncation is not producer flow control. |
| Listener/timer/worker/PTY cleanup | Partly implemented and verified | Protocol framers and diagnostic collectors dispose listeners explicitly. SSH forward startup releases diagnostic/readiness ownership. Browser language/formatter clients serialize requests, cancel obsolete callers and expire idle workers. Language-server leases now account for shared panes and pending operations; native tab/project switching and renderer reload release obsolete child processes while preserving drafts/undo. Preview startup/process cleanup and desktop PTY transport ownership are also verified. Host formatter, terminal scrollback/GPU state, preview iframe lifetimes, real server cold-start policy and cross-platform measurements remain open. |
| Weak references / finalizers | No correctness-critical use proposed | GC timing is not a cleanup contract. Use explicit disposal for watchers, subprocesses and worker ownership. |
| Object pooling / arenas / region allocation | Conditional, not implemented | Pools can retain high-water memory. Consider a bounded parser scratch region only after allocation profiles show a hotspot; never pool arbitrary chat objects by default. |
| Typed arrays / structure of arrays / compact IDs | Conditional | Suitable for dense indexes or numeric metadata, not a blanket rewrite of variable-length messages. Measure conversion and boundary costs. |
| Zero-copy / transferable buffers / shared memory | Conditional | Require clear ownership, bounds and cancellation. Moving work into a worker can duplicate large strings if messages are cloned. |
| Memory mapping / native page-cache tuning | Conditional | SQLite already provides native persistence. Map/cap changes need page-fault, RSS and I/O measurements; mapping a large file is not automatically less memory. |
| Native Rust/Zig helper, SIMD or parser acceleration | Conditional | Only promote measured CPU/data-layout hotspots. Compare bridge overhead, startup, total process memory, security surface and all supported platform builds. No native bridge added in this pass. |
| Mark/sweep, copying, compaction, reference counting, generational and concurrent GC | Runtime responsibility | These are alternatives/tradeoffs in memory management, not features to stack inside an Electron app. V8 chooses and implements its collector. |

## Measured persistence result

Recorded at `3532a17` in [stream-store-benchmark.json](performance/stream-store-benchmark.json), standalone Node v24.21.0/Linux x64. Each mode uses a separate process, 8 warmups and 40 measured persisted updates. Inputs are reset between modes. The previous mode requests thread-wide comparison; the optimized mode requests only the active message. Both use that commit's SQLite implementation. This isolates API scope rather than comparing historical binaries.

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

## Historical-view and document retention result

The [retention experiment](performance/retention-benchmark.json) compares policies using the same persisted data and separate Node processes. Garbage collection before/after each workload is a measurement boundary, not application behavior. The result fingerprints the actual read paths, cache helper and experiment source.

| Isolated workload | Previous retained state | Current retained state | Post-GC heap increase in this run |
| --- | --- | --- | --- |
| Two view cycles through 32 saved chats, 48 replies each | 32 writer histories, 1,536 fingerprints; 24,257,696 serialized message bytes | 0 writer histories/fingerprints/body bytes induced by views | 23.668 MiB → 0.818 MiB |
| Visit 40 saved documents with five old versions each; two dirty drafts | 40 panel entries; 55,855,945 serialized bytes | Three entries: current + two dirty; 4,189,191 serialized bytes | 45.366 MiB → 3.422 MiB |

The document cache's serialized retained representation fell by 92.5%. This is a panel-cache experiment, not a 92.5% application RAM claim. Saved documents also exist in backend thread metadata, and the selected chat lives in the renderer. The history result specifically removes read-only views from permanent writer retention; it does not evict a running writer's array. JSON row iteration also avoids an intermediate array of every SQLite row string.

Repeat historical reads perform a fresh SQLite parse. The measured repeat-read median was 1.048 ms versus 0.001 ms for already-hydrated in-process history in this fixture. This is not UI interaction latency: transport serialization and rendering are excluded. Large histories need further paging/rendering measurements rather than an assumption that all repeat reads cost 1 ms.

The [desktop retention record](performance/retention-desktop-verification.json) verifies the actual transport wiring, cross-document draft preservation and fresh saved revisions. The regression suite for this batch passed 394 tests; TypeScript and a production UI build passed. External-writer and live unsaved-stream identity checks cover the read-only/writer boundary. No real model or user conversation was used.

## Stream framing, diagnostics and startup lifetimes

The [process-stream experiment](performance/proc-stream-benchmark.json) uses the previous implementation and the current policy in separate Node v24.21.0 processes, with identical pre-decoded input. The final recorded run finished before the regression suite started. It includes ordinary short frames, not only the long-frame case that motivated the change.

| Synthetic workload | Previous measured processing time | Current measured processing time | Output check |
| --- | ---: | ---: | --- |
| 204,800 small JSON lines in 4,096-character chunks | 69.412 ms | 59.688 ms | Identical frame count and checksum |
| 20 roughly 525 KB JSON lines split into 256-character chunks | 6,987.060 ms | 36.845 ms | All 20 complete lines and checksum identical |
| 18,022,401 bytes of diagnostics with a final delimiter | 10,448.295 ms | 3.424 ms | Final bounded tail checksum identical |

For the still-open unterminated diagnostic stream, post-GC heap increase fell from 16.359 MiB to 0.101 MiB in this run. The old path first buffered an entire incomplete line before applying its tail limit; the new path applies the tail bound to each decoded chunk and already exposes diagnostics before the final delimiter. Protocol stdout still preserves complete frames. Its segmented assembler searches only new chunks, consolidates tiny fragments, and joins a completed line once. Ordinary complete short lines bypass scratch-array allocation.

Natural observed GC time in the long-frame workload was 880.004 ms versus 8.637 ms. Forced GC only establishes/settles benchmark boundaries; the application does not invoke it. This is one synthetic run with normal timing variance. It excludes JSON parsing, real child-process/SSH IO, complete provider execution, Electron process RAM and model latency. The large ratios must not be advertised as app-wide speedups. Negative post-GC deltas in the frame cases are measurement noise, not negative memory use.

SSH command execution now applies its configured `maxBuffer` independently to stdout and stderr, in bytes, retaining only the bounded prefix and failing clearly on overflow. Tests cover exact-limit success, newline-free overflow on each stream and UTF-8 output. Connection startup collects only an 8,192-character diagnostic tail and releases it after readiness or failure. Established forwards continue draining logs without collecting them. Repeated tests check 100 parser/tail disposal cycles, 30 real local TCP readiness cycles, startup errors and a real child timeout. Native port-forward functionality remains covered by the offline SSH integration fixture.

The final source fingerprint matches the benchmark report. After that measurement completed, the full regression suite passed **406 tests, 0 failures**. TypeScript, the production UI build and whitespace checks passed. These checks do not verify packaged/cross-platform process memory or real local-model inference.

These changes address specific retention/allocation owners. Line-delimited agent stdout with no newline can still retain a large incomplete frame; broad producer backpressure, IPC queues and all other worker/PTY lifetimes remain open. No Rust bridge or collector replacement is needed for these JavaScript buffering fixes.

## Local generation admission and memory ownership

[local-requests-benchmark.json](performance/local-requests-benchmark.json) runs 24 real HTTP requests against a disposable loopback server. Each actual received JSON body stays owned until that request's fixed 30 ms reply. No inference engine or artificial weight/KV-cache allocation is used. The ungated comparison uses the compatible-provider route with the same payload; configured local profiles use the new admission queue.

| Admission policy | Peak overlapping bodies | Peak bytes held by the fixture receiver | Completion time in this run |
| --- | ---: | ---: | ---: |
| Previous ungated behavior | 24 | 1,538,976 | 115.489 ms |
| 1 request (default) | 1 | 64,124 | 822.556 ms |
| 2 requests | 2 | 128,248 | 465.195 ms |
| 4 requests | 4 | 256,496 | 273.526 ms |

All 24 replies matched and completed in every case; client pool counts and held receiver bodies returned to zero. Lower overlap trades throughput for queueing in this delay-based fixture. These are exact HTTP payload counts/bytes, not estimates of GPU memory or an inference speedup. Prompt/history objects and attachments may already be resident while a request waits; this does not impose a total-memory ceiling.

`core/local-requests.js` shares slots across local profiles/models/path aliases at the same loopback scheme/port. It defaults to one active request and caps waiting entries at 64 per service. A stricter queued/active profile is respected without preempting already-running requests. Other local service ports can progress independently. Admission happens before request JSON serialization and before the generation timeout starts. Queued cancellation removes its abort listener and entry without sending a request; already-admitted requests release ownership on success, HTTP failure, invalid streams, timeout or cancellation. The slot is per generation, not an entire multi-tool task, so tool work/approval waits do not reserve a model slot. External native CLI traffic and other app processes do not pass through this gate.

The setting persists through the host profile and is available in both local-model onboarding and connection editing. The chat displays Waiting for local model only for a currently running host turn. The [desktop verification](performance/local-requests-verification.json) covers the native UI setting, queued Stop without a second POST, and two fresh chats finishing in order with their phase fields cleared. Unit/integration checks cover FIFO ordering, aliases, separate services, stricter mixed profiles, 100 cancelled waiters, queue overflow, profile restart, HTTP/stream errors and timeout cleanup. The full regression suite passed 416 tests; TypeScript and the production UI build passed.

Metadata-only discovery found the standard Unsloth, Ollama and LM Studio endpoints offline on this machine at the time of this pass. No runtime or model weights were installed, loaded, unloaded or reconfigured. Real inference RAM/VRAM, runtime preallocation and hardware-specific throughput are unverified. The official Ollama FAQ supports the need to account for concurrent context allocation; it does not prove a particular amount saved by Tributary's client limiter.

## Browser worker ownership and idle expiry

The [native lifecycle record](performance/worker-lifecycle-verification.json) samples the source-run production UI in Electron 44.7.2 on a disposable Linux/Xvfb profile. No dedicated worker existed on the initial README preview. Opening JSON documents created a language worker; sequential visits reused that target. One idle sample reported 12,551,284 used JavaScript heap bytes in its isolate. After inactivity the target disappeared. Undo triggered a different worker target, and a second idle/restart cycle produced a third target. These are observed resource lifetimes, not a before/after heap benchmark or a claim that the app saves 12.6 MB of RAM.

The client now gives language assistance a 60-second idle lifetime and the browser formatter 30 seconds. A deadline applies only when no work is active or queued. Only one request is posted at once, reducing overlapping structured clones; up to 16 language or 8 formatter requests may be owned by the client. These are count limits, not a byte budget. Caller cancellation removes obsolete queued inputs before posting. A posted cancelled job keeps ownership until its response/deadline if another caller needs the worker; if nobody needs it, the worker terminates. Startup generation identity and abort signals prevent late asynchronous loading from reviving an old worker. Listener, timer and blob-URL cleanup follows explicit ownership.

[MDN's Worker.terminate documentation](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate) explains why termination must not interrupt work that still has an owner: termination is immediate and provides no completion opportunity. This worker only calculates language/formatting results; it does not own editor persistence. EditorView and its undo history remain mounted. Native checks preserved an unsaved trailing-space edit through expiry, restored the original text with undo, restored the dirty edit with redo, and showed/removed a real JSON error after restart. Tests also cover 100 cancelled waiters, startup cancellation, late results, error/timeout recovery, queue limits, structured-clone failure, formatter decoding and webview URL disposal.

The [Chrome DevTools protocol](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) defines `Runtime.getHeapUsage` as usage of the corresponding isolate, not a particular Runtime and not process RAM. `scripts/performance/worker-heap.cjs` attaches only while sampling and detaches afterward. No forced GC was used. The recorded samples bracket the first expiry between 36.186 and 81.214 seconds after the active sample; this does not measure its exact deadline or garbage collection latency. Parser caches, transient allocations and loaded modules all contribute to the sampled heap. Renderer documents, Electron/GPU resources and browser code caches are outside this measurement.

The full regression run passed 425 tests, including the initial nine worker-client tests. Three subsequent cleanup/decoder tests brought the separately rerun worker suite to 12 passing tests. TypeScript, a fresh production UI build and whitespace checks passed. Native formatting normally uses the host formatter, so no native browser-formatter memory saving is claimed. Real VS Code webview runtime, packaged builds, cold-start/rapid-typing latency and host formatter lifetime remain unverified by this experiment.

Visited file panes still retain their editor state. Blindly unmounting them could discard dirty drafts or undo. The subsequent ownership pass below addresses shared language-server documents separately; browser worker termination alone does not solve that ownership boundary.

## Language-server leases and inactive project panes

The source audit found two connected problems. Hidden visited project panes kept their language-server document registrations; meanwhile, closing any pane closed the same document for every pane. The previous close-generation map also retained an entry for every closed path indefinitely. Unmounting whole editors to release a server would discard undo history, so the implementation separates language ownership from editor lifetime.

Each visible configured editor now acquires an opaque lease through the desktop/VS Code bridge. A host document can have multiple pane owners, but only one LSP registration. Released tokens cannot be used to reopen a document. Async path checks and server initialization recheck the captured lease, so a late old request cannot close or resurrect a replacement owner. Document states track admitted operations until settlement: a formatter that already sent its request can finish after its pane hides. The final owner/operation removes the document and closes an otherwise unused server. Owner metadata is capped at 512 live leases and deleted on release; no closed-path generation map remains. Server failure releases cached document bodies and protocol buffers.

The UI passes existing workspace/folder visibility into CodeEditor, releases language subscriptions/leases and cancels built-in validation while hidden, and reopens with its latest text when visible. EditorView is not recreated by this visibility change. Desktop main-frame replacement or renderer loss clears the single renderer's language ownership; VS Code disposal releases only leases acquired by that webview. These changes do not unload all visited editor state, suspend every hidden subscription, or alter background coding-agent execution.

The official [LSP 3.17 synchronization contract](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_didOpen) requires a balanced single document registration and distinguishes client content management from whether a document is visible in an editor. That supports one host registration shared by pane owners; it does not require a language server to stay loaded for every historical UI pane. The [Electron navigation event](https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation) distinguishes main-frame document replacement from same-document/subframe navigation. The implementation uses the installed Electron 44.7.2 event details instead of the deprecated positional fields.

The [verification record](performance/language-owner-verification.json) contains source fingerprints and 11 native process snapshots. A deterministic Node stdio LSP server supplied an actual diagnostic to an unsaved TypeScript draft. Selecting Memory stopped that process while the editor and dirty text remained mounted. Returning to Files started a new process; undo restored the exact original text and removed its dirty/error markers. Switching to another project's preview left zero server processes; opening that project's TypeScript file started only its server. Returning stopped that server and restored the first project's draft, with two retained EditorViews and only the visible project's server running. Renderer reload stopped its old process; after initialization, the restored editor acquired a different server process. All six native fixture server processes were gone at test teardown.

Integration tests cover two owners of the same URI (including in-project symlink aliases), initialization/close/reopen races, another initializing document, a real delayed formatting response after owner release, stopAll/restart races, 1,000 released/unknown owners and disabled opens with zero retained metadata. The VS Code stand-in test verifies two webviews sharing a document, disposal of one without closing the other, rejection of calls from a disposed view, and final-owner shutdown. The final full suite passed **434 tests, 0 failures**; TypeScript, production UI build and whitespace checks passed. Native snapshots predate the final resolved-URI refinement; the report preserves their original source fingerprints separately from the final test-verified source fingerprints.

These observations establish ownership and process termination, not a whole-app RAM reduction. The fixture's child RSS reflects a small Node test server, not TypeScript/rust-analyzer/gopls indexing or private/shared process accounting. Immediate release can trade memory for repeated initialization and reindexing. Real-project latency, a measured idle grace policy, actual VS Code webview reload without disposal, renderer-crash execution and packaged/macOS/Windows checks remain open. Dirty text/undo retention remains deliberate and must be measured before pane eviction is considered.

## Native process-tree retention and observer effects

The [process-tree experiment](performance/process-tree-benchmark.json) adds a source-run Electron/Linux/Xvfb workload: six projects, one 2,500-line TypeScript file each, and six persisted chats with twelve user/assistant exchanges each. No model was invoked and no language-server profile was configured. All six EditorViews remained mounted deliberately; one editor and the current chat were visible. Five samples per phase pair renderer diagnostics with the seven observed Electron descendant processes.

[Linux procfs documentation](https://docs.kernel.org/filesystems/proc.html) defines PSS as each process's proportional share of resident pages and provides `smaps_rollup` for aggregated mapping statistics. The sampler reports PSS, private clean/dirty pages, RSS and hugetlb fields separately. Summing RSS double-counts sharing; hugetlb is not included in ordinary RSS/PSS. Process identities and the observed tree are checked before/after sampling. A missing/reused process or unreadable selected memory file yields incomplete/null totals. Reads are still non-atomic, and unreadable intermediate parents or detached helpers can escape the observed tree.

The [DevTools Runtime contract](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) scopes heap usage to an isolate; [Memory.getDOMCounters](https://chromedevtools.github.io/devtools-protocol/tot/Memory/#method-getDOMCounters) reports DOM object counters. Explicit renderer GC is used only at the diagnostic boundary, not in the product. Main-process and worker-isolate GC were not requested. These numbers must not be called total app JavaScript heap or GPU memory.

The first connected-observer runs appeared to add 576 DOM nodes per repeated six-project pass. A heap snapshot instead found 19 closed command inputs directly retained by DevTools console global handles, with 1,546 detached DOM nodes in the captured graph. Clearing console entries through a separate sampling connection alone did not remove the automation observer's handles. Disconnecting that observer released the closed dialogs. No product cache was changed in response to this measurement artifact. The report retains those initial phases as diagnostic evidence, separate from the corrected comparison.

Corrected samples disconnect automation, discard test console entries, collect the renderer for measurement, sample, and detach the diagnostic connection. The baseline already has all six editors warm, including one prior Memory visit; it is not a cold one-project baseline.

| Corrected phase, median of five samples | Renderer used heap bytes | DOM nodes | Process-tree PSS, KiB | Language-worker targets |
| --- | ---: | ---: | ---: | ---: |
| Warm six-project idle baseline | 27,951,488 | 8,894 | 352,421 | 0 |
| First repeated six-project pass | 27,896,876 | 8,894 | 392,760 | 1 |
| Second repeated six-project pass | 27,909,044 | 8,894 | 394,311 | 1 |
| Idle after the repeated passes | 27,845,132 | 8,894 | 351,987 | 0 |

The two active repeats differ by 12,168 renderer heap bytes and zero DOM nodes. Final idle PSS is 434 KiB below the already-warm idle baseline. Active-to-idle PSS differs by 42,324 KiB while the worker target disappears; this correlation is not a controlled attribution of every byte to the worker. Natural GC, allocator/page behavior and shared-page accounting can change process memory. These results establish a reproducible bounded workload observation, not universal leak freedom, lower peak RAM or a claimed app-wide percentage improvement.

The new procfs sampler was checked with golden totals and unrelated-process exclusion, a missing selected memory file, PID reuse, missing root/PSS rejection and a real self-process sample. Native samples also exposed Chromium's rewritten single-string argv; role classification handles that without emitting entire command lines. The reproducible fixture was reopened to verify all six persisted 24-message chats. Application regression checks remain at 434 passing tests; the standalone samplers and fixture received their focused accounting/syntax/persistence checks.

Next measurements must extend this baseline to dirty/undo-heavy editor lifetimes, pending saves, terminal/preview cycles, active provider/tool traffic and real model runtimes. Clean visited-pane state remains a measurable working-set cost and requires explicit selection/folding/search/undo/pending-operation preservation before eviction. Packaged/macOS/Windows runs and cold-start/interaction timing remain open. Full book access/review is not implied by this experiment; the reading scope remains recorded above.

## Language-server byte framing and retained transport buffers

The stdio LSP reader previously concatenated the accumulated buffer on every data event, rescanned its header and kept subarray tails into the completed transport allocation. The current reader in `core/lsp-framing.js` parses the header once, reads contiguous complete bodies synchronously, and grows a private buffer geometrically only as fragmented body bytes arrive. A declared maximum-size body allocates no body storage until data arrives. The maximum is 8 MiB **per body**, with a separate 8 KiB header limit; it is not a total application memory budget. Transient old/new growth buffers, the incoming chunk, decoded JSON and other sessions have additional costs.

The [official LSP base protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol) defines ASCII headers and byte-counted UTF-8 bodies. Length checks apply to each frame rather than rejecting an otherwise valid coalesced batch solely because its total exceeds one frame's limit. Invalid/duplicate lengths, oversized headers/bodies and truncated input release the reader. Invalid JSON-RPC top-level values reject pending requests. A server closing stdout while keeping its process alive now fails promptly instead of retaining a pending request until its timeout. Shutdown removes its data listener, clears pending timers, releases buffers/documents and stops the child; document ownership remains governed by the existing pane leases.

The [Node Buffer documentation](https://nodejs.org/api/buffer.html#static-method-bufferallocunsafeslowsize) describes using unpooled storage for a small retained fragment. This reader uses dedicated header/body allocations for that purpose. These buffers are not exposed until the corresponding bytes have been written; unused allocation capacity is never decoded or passed to the consumer. This policy is specific to retained protocol fragments, not a recommendation to disable pooling throughout the app.

`npm run bench:lsp -- --output docs/performance/lsp-framing-benchmark.json` compares the previous and current policies in separate Node processes over three alternating-order rounds per workload. An untimed batch checks full-body checksums and counts bulk-copy bytes; timed runs check frame counts without copy/hash instrumentation. The timing excludes JSON parsing, fixture construction and subprocess IO. Natural GC observations exclude forced diagnostic collections. Memory samples between batches can miss transient peaks. The independent tail test drops transport references before collection and releases the reader afterward. See the report for source fingerprints and measured results. These are parser/allocation measurements, not complete language-server throughput, total Electron RAM, real indexing latency or inference performance.

Recorded Linux/Node v24.21.0 results (three rounds; median accumulated framing time):

| Workload | Frames per timed run | Bulk-copy bytes per untimed batch, before → after | Median measured framing ms per run, before → after |
| --- | ---: | ---: | ---: |
| 128 small coalesced frames per batch | 102,400 | 14,628 → 0 | 324.460 → 154.000 |
| Separate small header and body writes | 25,000 | 137 → 0 | 317.247 → 173.557 |
| About 1 MB, arriving in 256-byte chunks | 8 | 1,954,375,048 → 2,044,309 | 7080.401 → 13.557 |
| About 4 MiB, arriving in 64 KiB chunks | 8 | 140,509,256 → 12,189,552 | 689.326 → 68.579 |

Copy counts include explicit bulk buffer copies, not scalar header-byte writes, decoded strings or JSON allocation. Timings varied substantially between rounds; the report preserves every round. The regression suite had finished before this recorded run, but unrelated OS activity, CPU frequency and scheduling were not isolated. These are observations on this host, not a latency guarantee or a whole-app speedup. The optimized path was faster in every paired round in this run.

The independent partial-tail fixture delivered one completed 4 MiB body followed by an unfinished 8 MiB-declared response containing one byte. After input references were dropped and diagnostic GC ran, the reader retained **4,194,359 bytes before versus 4,096 bytes after** in backing allocations; post-GC `arrayBuffers` deltas matched those sizes. Both policies returned to zero additional array-buffer bytes after disposal in that fixture. No production GC call was added. This single-tail result is not total process RAM or peak-memory evidence.

`test/lsp-framing.test.js` covers Unicode and every byte boundary, coalesced frames, exact limits, invalid lengths, lazy growth, partial tail retention and repeated disposal. `test/language-tools.test.js` also uses actual stdio child processes with serialized fragmented output, concurrent completion/formatting/diagnostic traffic, invalid JSON objects, truncated frames and empty stdout closure. This is a deterministic fixture, not real gopls/rust-analyzer/indexing evidence. Broad agent stdout backpressure, IPC and PTY queues remain open.

## Preview startup and process ownership

`PreviewServers` now registers a cancellable startup before awaiting command discovery or project environment preparation. Stop and application shutdown cancel that ownership and settle the caller without waiting for a stalled preparation. Late successful or failed preparation cannot launch a child, change a stopped job, or delete the token of a newer startup for the same root. The desktop's environment preparation now happens inside that lifecycle; the quit guard includes pending starts as well as running children. Cancellation revokes startup ownership; it does not abort filesystem or secret-store IO already executing.

Real preview output streams decode UTF-8 independently before the retained diagnostic tail is updated. The tail keeps at most 32,768 UTF-16 code units, cuts input before concatenation, and avoids starting on a low surrogate. This is a logical diagnostic-tail bound, not a measurement of V8 string backing storage, total process RAM or raw output retention. Preview logs are a tail; they are not a lossless recording. ANSI sequences split across chunks are not interpreted as a terminal emulator would interpret them.

Finished jobs clear their coalescing timer and release stdout/stderr, spawn and error listeners. The job keeps bounded output/URL/status metadata for the stopped-preview UI, but its child and settlement promise references are cleared. Concurrent stop calls share the same completion instead of adding independent close listeners and escalation requests. The existing process-tree termination helper still owns its bounded escalation deadline; this is not a claim that every OS resource or native allocation vanishes immediately.

`test/preview-browser.test.js` covers cancellation during unresolved discovery and unresolved lazy environment preparation; late failure; stop-all across stages; replacement-start token races; concurrent stops on a real child; byte-fragmented UTF-8 on each pipe; ten repeated real child lifetimes with no retained output listeners/timers or delayed state events; and preparation failures. Existing tests retain actual localhost HTTP start/restart/stop behavior and exit codes. The [verification record](performance/preview-lifecycle-verification.json) includes 10 focused checks and 453 passing full-suite tests. These are lifecycle/correctness checks, not a before/after whole-app RAM benchmark. The [terminal flow-control record](performance/TERMINAL_FLOW_PLAN.md) now records the implemented desktop contract, its verification gates and remaining measurements. Stopped-job metadata across many different projects, iframe/browser lifetimes, aggregate terminal budgets, visited xterm scrollback/GPU retention and broader agent/IPC backpressure remain open.

## Desktop terminal flow control and recovery

Fast producers are now governed by xterm parser acknowledgments, rather than merely batching their IPC messages. The host retains a maximum outstanding window of 131,072 UTF-16 code units, sends frames of at most 16,384 units, and also caps outstanding packets at 128. Low character/packet watermarks provide hysteresis before resuming the PTY. Already-delivered native reads may temporarily overshoot the character watermark; a producer that ignores pause cannot be made memory-bounded by this counter alone. These are transport accounting units, not bytes or total application RAM.

The [official xterm flow-control guide](https://xtermjs.org/docs/guides/flowcontrol/) recommends write callbacks and high/low watermarks to propagate backpressure through a real PTY. Installed xterm typings confirm that the callback follows parsing; installed node-pty exposes pause/resume. The renderer coalesces acknowledgments only for the contiguous parsed prefix. Tokens reject stale callbacks after detach/reload. A new view registers before the host releases initial output; unacknowledged frames are replayed in order before new frames. Natural exit waits for the final ACK, while explicit close can discard remaining display output and disposes transport state and subscriptions. Timer flushes clear their prior scheduled ownership. Renderer replacement or shutdown also invalidates terminal creation still awaiting project environment values, so it cannot spawn a paused orphan afterward; filesystem/secret-store IO already running is not itself aborted. No forced production GC, collector replacement or native-language bridge was added.

The [verification record](performance/terminal-flow-verification.json) covers 12 focused transport/PTY tests, 23 existing direct/SSH terminal tests and 465 passing full-suite tests. A real local PTY delivered 4 MiB of ASCII output through a deliberately slow stand-in consumer with exact checksum parity. The final native Electron run exercised actual xterm output flooding, hiding/reopening, reload/adoption, Ctrl+C, Unicode output and the final exit marker. The same terminal and shell PID survived reload, while its consumer token changed. Outstanding text reached the configured 131,072-unit ceiling; retained transport reached 181,589 units, within that ceiling plus the largest observed read (65,536 units). After interruption, retained transport returned to zero. Disposable producer and shell PIDs were verified absent at teardown. Type checking and the production UI build passed.

The native run took place alongside regression activity, so no typing or interrupt latency distribution is claimed. The checksum case uses a stand-in parser; native xterm evidence checks markers, window bounds, hide/reload and interruption. Recovery preserves the shell and unacknowledged frames, not already-parsed scrollback or terminal editor state. Hidden consumers can slow output when their parser is throttled. Direct non-renderer TerminalManager users retain their previous synchronous event contract. Whole-app RAM, native/GPU allocations, aggregate terminal budgets, scrollback working sets, packaged builds and macOS/Windows native runs remain open. The [contract record](performance/TERMINAL_FLOW_PLAN.md) preserves the remaining gates.

## Measured terminal queue backlog and writer working set

The [real-PTY queue benchmark](performance/terminal-flow-benchmark.json) runs three alternating-order pairs in separate processes. Each produces exactly 8 MiB of ASCII through synchronous native writes. The consumer is intentionally paced by a fixed character budget; it is not xterm, and no Electron IPC is involved. Full output checksums and final counts match in both policies. The event-only legacy mode has a median peak receiver backlog of 7,782,399 code units; acknowledged transport has 131,072. Median elapsed completion is 1115.823 ms versus 1460.716 ms in this run. Lower backlog trades throughput for pacing in this fixture. Host and receiver accounting overlap; those counts are not physical bytes or a claimed percentage reduction in total app RAM.

The [writer working-set baseline](performance/writer-working-set-baseline.json) isolates current behavior over 0/4/16/32 saved histories. Read-only views leave writer histories unloaded. Completed synthetic writer updates still retain the loaded arrays: 32 visited chats add roughly 76 MB of live heap in this recorded case. Read-only bursts retain few live objects but commit substantially more V8 young-generation memory; yielding between snapshots did not remove that cost in the additional comparison. Diagnostic-only SQLite shrink and a 1.5-second unforced wait did not materially reduce this observed working set. This is one current-policy standalone Node experiment, not real agent orchestration, Electron memory or proof that the runtime leaks. No production GC timer, heap flag or SQLite shrink policy was added.

The [source ownership audit](performance/WRITER_HISTORY_OWNERSHIP.md) identifies why simply dropping finished arrays is unsafe. Nested race judgment can outlive its inner turn; verification captures a message before registering its run; checkpoint work awaits IO; full flush deletion detection depends on loaded-message fingerprints. Balanced operation ownership, external-write reconciliation and exact persistence checks are required before enabling eviction. This is a pending implementation, not a completed cache rewrite. The [audit verification](performance/retention-audit-verification.json) records 465 passing regression tests, type/build checks and source hashes.

Preview close handling also removes that tab's revision counter and clears a pending automatic-navigation target. It preserves open page rendering and histories; no native preview memory-reduction claim is made for this small cleanup. Project-session metadata and live iframe state remain separate owners.

[Node V8 accounting](https://nodejs.org/api/v8.html#v8getheapstatistics) distinguishes object usage and physical heap commitment. [SQLite's memory-release pragma](https://www.sqlite.org/pragma.html#pragma_shrink_memory) asks the connection to free what it can; the diagnostic result does not exactly attribute PSS. OSTEP chapter 17 adds allocator-policy and fragmentation context: faster allocation and lower waste depend on workload, and free-space management is distinct from application liveness. Its C/OS examples are not evidence about the installed V8 collector. Full book access/review remains limited to the reading scopes above.

## Remaining verification and implementation work

1. Extend the recorded Linux desktop checks to packaged builds and automated repeated-cycle retention measurements. Keep functional checks separate from bundle-size and memory evidence.
2. Extend the Linux process-tree/renderer repeated-cycle baseline to main-process heap profiling and dirty/undo-heavy editor, provider, terminal and preview workloads. Address writer histories and visited project panes with explicit pins for dirty drafts, selection/folding/search state, undo history, pending operations, running turns and approvals. Keep external-writer reconciliation intact.
3. Audit queues, workers and watcher lifetimes under long outputs, cancellation, network loss and repeated open/close cycles. Benchmark the identified hot paths rather than adding unconditional pooling or GC calls.
4. Extend the verified client-admission behavior to measurements of local runtime weights/context/concurrency on actual available hardware. Keep provider generation time and VRAM separate from UI costs.
5. Repeat relevant checks in packaged Linux, Windows and macOS builds before making cross-platform performance claims. A local production build is not installer or release verification.

The older [native bridge investigation](PERFORMANCE_ARCHITECTURE.md) preserves historical observations/proposals. It is not an up-to-date checklist of missing features.

## Owned writer-history release

The ownership audit is now implemented in the local desktop and VS Code hosts. A single owner-aware idle cache replaces permanent retention of completed writer histories. Details, checks and measurement boundaries are in [WRITER_HISTORY_OWNERSHIP.md](performance/WRITER_HISTORY_OWNERSHIP.md). The policy releases only durable histories with no operation/transport owners; it preserves mutable identity during nested, overlapping and background work. Direct mutable SDK access remains unmanaged and the JSON fallback keeps its existing behavior.

The OSTEP cache-policy chapter reinforced two requirements here: dirty data must settle before reuse, and replacement policies need workload-specific miss-cost measurements. Neither LRU nor a low live-object count by itself proves better process RAM. The report therefore keeps cold reconstruction latency, natural idle memory, diagnostic live heap, committed heap and process-tree PSS separate. No OS paging policy or forced production collection was copied into the app.


## Visible-only terminal graphics resources (local, unreleased)

The native Linux desktop fixture now gives graphics resources to visible terminal panes only. Shells, parser state, scrollback, output acknowledgements and search remain mounted when the GPU renderer is released. Reopening activates a fresh renderer on the existing terminal. Hidden tabs and a hidden terminal panel have no WebGL contexts. Context-loss retries are bounded and cancelled on hide or disposal. The adapter uses public xterm APIs and the canvas WebGL API; it does not inspect private xterm fields or force collection.

[Baseline](performance/terminal-graphics-baseline.json) and [current native fixture](performance/terminal-graphics-current.json) use eight real local shell processes and a disposable profile, with no provider calls. Before the change there were eight non-lost contexts with one tab visible, and eight with the panel hidden. After the change those counts are one and zero. Four visible split panes have four contexts. Sixteen unique scrollback searches pass across two cycles through eight tabs; original shell IDs remain unchanged. Forced context loss recovers while visible and cannot resurrect a hidden renderer after its retry deadline.

These are graphics-context/resource lifetime counts under Linux Electron with ANGLE SwiftShader, not a VRAM-byte or app-RAM benchmark. Driver behavior, hardware rendering, packaged applications and other operating systems still require measurement. No terminal output is truncated or shell terminated to obtain these counts. Created-minus-deleted handle counters after context loss are not native live-handle counts because context loss invalidates resources implicitly.

Sources checked: [xterm addon lifecycle](https://xtermjs.org/docs/guides/using-addons/), installed addon-webgl 0.19.0 disposal/context-loss code, and [Khronos WEBGL_lose_context](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/). Disposal deletes addon-owned resources and explicitly loses its detached context when supported; an already-lost context is not lost twice.

Additional reading: [Data-Oriented Design, Searching](https://www.dataorienteddesign.com/dodbook/node7.html), author-provided reduced online edition. Reviewed the chapter prose and timing table on search-key/payload separation, indexes, linear-versus-binary workload measurement and update costs. Image-only C++ listings were not reviewed. This supports measuring metadata/payload separation; it does not justify a blanket typed-array rewrite or a claim of whole-book coverage.


## Bounded directory-page selection

The Explorer previously materialized every directory entry, filtered it into a second array and sorted the entire visible folder for each page. For requested prefixes of at most 4,096 entries, the reader now opens a non-recursive directory stream with a 256-entry native buffer and retains only the smallest `offset + limit` entries in a max heap. It still scans the folder to report an exact visible total and the next offset. Hidden-file handling, directory-first locale ordering, lexical tie-breaking, in-project linked folders, broken links and project containment remain intact. Directory handles close after EOF, read errors, synchronous errors and the existing 100,000-entry refusal.

This is selective materialization, not a directory cache or a lifetime rule for unsaved editors. Deeper pages retain the old native bulk-read/filter/sort path: the stream-only experiment retained most of the prefix anyway and approximately doubled warm later-page time in an exploratory run. Async iteration was also slower than callback streaming in the initial comparison. No Rust bridge, forced production collection or periodic cache-clearing timer was introduced.

The [benchmark](performance/directory-page-benchmark.json) uses actual disposable folders and compares against `d4d0663`, with three subprocesses per policy/case and seven warm timing samples per process. Periodic memory/event-loop profiling and paused WeakRef reachability checks use separate subprocesses. Both policies return checksum-identical entries, totals and next offsets. The final recorded benchmark ran after regression/native checks finished, avoiding interference from this task's test processes. The source/runtime fingerprints and raw runs are retained.

| Workload | Previous warm median | Current warm median | Previous / current selection-phase reachable entries |
| --- | ---: | ---: | ---: |
| 80 entries, first page | 0.795 ms | 1.214 ms | 80 / 80 |
| 5,000 entries, first page | 6.077 ms | 7.313 ms | 5,000 / 200 |
| 25,000 entries, first page | 32.651 ms | 34.486 ms | 25,000 / 200 |
| 25,000 entries, offset 20,000 | 31.977 ms | 31.420 ms | 25,000 / 25,000 |

For the large first page, median process-lifetime maximum RSS across the timing subprocesses was 92,764 KiB before versus 70,552 KiB now. The separate profile's sampled heap peak was 20,792,024 versus 8,290,776 bytes, and maximum observed event-loop delay was 26.460 versus 16.892 ms. Sampling can miss peaks. These are Node reader workloads, not total Electron RAM, native page-cache attribution, GPU memory or local-model memory. Small/medium scans do not show a uniform process-memory improvement. Cold large-page reads remain slower (61.047 versus 83.336 ms; module load plus first read: 68.101 versus 89.994 ms). The recorded result is a bounded-memory tradeoff, not an app-wide speedup. Deep pages retain their old memory cost.

The [verification](performance/directory-page-verification.json) records 519 passing regressions and a real desktop Explorer paging from 200 through 400 to all 507 fixture entries, with no pagination button left and the final file opened in the editor. Tests compare against full sorting for ascending, descending and mixed Unicode inputs, cross the hybrid threshold on a real folder, preserve linked-directory behavior, and verify stream cleanup/error precedence. Packaged/macOS/Windows performance remains unmeasured.

Reproduce with `npm run bench:directories -- /absolute/path/report.json`. The benchmark uses diagnostic GC only at measurement boundaries and in the isolated reachability probe; product code does not invoke GC. The [Node directory API](https://nodejs.org/api/fs.html#fspromisesopendirpath-options) defines buffering and directory handles. Installed Node 24's callback/async-iterator source was inspected to explain per-entry callback versus promise overhead, without using private APIs in production. Priority-queue reading is scoped in the book inventory above.


## Non-streaming snapshot lifetime and async delivery ownership

The patcher used to cache every full message whose `ok` field was absent/null. User prompts normally have no `ok` field and never receive an assistant-completion update, so their snapshot strings remained reachable for the host session even after writer histories were evicted. User and system messages now always travel as full messages without becoming delta bases. Role replacements clear an earlier base too. Assistant streaming, in-place tool mutations, optional-field removal and final-state reconstruction retain their existing behavior.

The delivery coalescer also previously started a fresh asynchronous send after each timer, even if earlier sends were unresolved. It now owns at most one unresolved send and one latest pending state **per message**. New events update that pending state; patches are computed only when a send can begin. Full/final messages replace pending partial state and are delivered whole after the earlier send settles. Unrelated messages progress independently. History leases remain held through actual transport settlement; disposal releases pending ownership, removes timers/listeners, and prevents late settlement from starting another send. A synchronous throw, rejected Promise, false delivery result or throwing thenable getter releases ownership and invalidates the old patch base. The VS Code broadcast wrapper now propagates unsuccessful post results instead of hiding them inside `allSettled` output.

[Reproducible benchmark](performance/message-delivery-benchmark.json), compared with `b3289ae`, uses three alternating-order pairs of isolated Node subprocesses. It does not invoke a provider or use real chats. Snapshot allocation and explicit fixture transport bytes are different measurements:

| Isolated workload | Previous | Current |
| --- | ---: | ---: |
| 800 synthetic user prompts, streaming bases retained | 800 | 0 |
| Post-diagnostic-GC heap increase after those prompts | 26,679,584 bytes | 84,552 bytes |
| Stalled transport: peak unresolved sends | 242 | 1 |
| Stalled transport: peak history-owner leases | 242 | 2 |
| Peak explicitly queued fixture JSON | 5,802,934 bytes | 1,036,997 bytes |
| Final reply reconstruction | Exact | Exact |

Each prompt is about 32 KiB; the prompt-cache result is not a prediction for typical short prompts. The async transport fixture generates 240 updates, retains serialized transport JSON until explicitly released, and checks the complete final text, nested tool output, trace and permission history. It sends two messages with coalescing versus 242 before; intermediate presentation snapshots can be skipped, while their accumulated state is kept. Owner counts are not duplicate copies of the chat history. The sender's live message, persistence state and receiver copy have separate costs. Forced GC is used only in these diagnostic subprocesses, never in production.

This earlier helper-only experiment did **not** establish backpressure on agent stdout or a bound on Electron's downstream IPC. Desktop `webContents.send` returns synchronously, so the helper alone cannot infer when the renderer consumed an update. The desktop acknowledgement and reload work below subsequently addresses per-message IPC ownership. Aggregate concurrency limits and actual native consumer-memory measurements remain open. VS Code's broadcast delivery still waits for all target webviews; per-view independent pacing needs its own contract and tests. A smaller host-side queue is not a total application RAM or model-memory ceiling.

Tests cover 500 coalesced updates, stalled/unrelated messages, exact patch bases, final full messages, nested mutation, permission history, rejection/false/thenable failures, synchronous reentrancy and disposal before settlement. The source fingerprints, final regression result and desktop transport smoke check are recorded in [verification](performance/message-delivery-verification.json). Reproduce the isolated experiment with `npm run bench:delivery -- /absolute/path/report.json`.


## Desktop receiver acknowledgements and reload ownership

Desktop reply delivery now resolves only after the isolated preload dispatches a full message or delta to its synchronous listeners. The coalescer therefore limits each reply to one unresolved IPC packet plus its latest pending state, even while renderer JavaScript is stalled. The controller retains acknowledgement resolvers and identifiers; it does not make another reply snapshot. State/notification/file events retain their existing channels and do not inherit this bound.

Each main-frame document has a fresh epoch. The preload declares readiness only after both full-message and patch listeners exist. Navigation/crash suspends active continuations, and the next ready consumer requests a full replay using the newest pending state; an interrupted final is replayed even if no new event arrives. Old epochs, duplicate/unknown acknowledgements and IPC from a different frame cannot release current ownership. A destroyed window closes continuations; disposal prevents late settlement from resurrecting delivery. Replacement ownership is acquired before the old history lease is released.

Acknowledgement means synchronous listener dispatch, **not** successful React commit, paint, or proof that a newly selected conversation has hydrated. It uses a microtask rather than an animation frame so a hidden window is not forced to wait for painting. Broader selection/snapshot reconciliation and application-wide budgets still require work. A callback exception invalidates the patch base; this is not a general UI error recovery mechanism.

The [native benchmark](performance/desktop-ipc-delivery-benchmark.json) compares three pairs under Linux Electron 44.7.2. Each creates a disposable profile/project, blocks real renderer JavaScript for two seconds, and produces 100 synthetic incremental updates followed by a full final reply. The baseline uses `93f5e5c` desktop main/preload with the same current coalescer and built UI, isolating the acknowledgement protocol. Baseline/current order alternates after the first exploratory pair. All runs reconstruct the exact final message in the renderer and release history owners. No model/provider request is made.

| Median per fixture | Previous desktop transport | Acknowledged transport |
| --- | ---: | ---: |
| Reply packets submitted while the renderer is blocked | 14 | 1 |
| Serialized reply payload bytes submitted while blocked | 394,678 | 280 |
| Total reply packets after draining | 14 | 2 |
| Total serialized reply payload bytes after draining | 394,678 | 201,091 |

The coalescer preserves accumulated text/tools/trace/permissions while skipping obsolete presentation snapshots. The current replay check also reloads with an unacknowledged reply and a queued final: a new epoch sends the complete final state, the actual chat renders it, persisted text matches, and no history owners remain. During the producer's operation the current fixture peaks at three history leases versus two before: operation, active IPC and latest pending state. These leases are references to one history, not three copied histories. Keeping an active transport owner until dispatch is intentional correctness work.

These counts are actual host IPC submissions and diagnostic JSON byte counts, **not** Chromium queue allocation bytes, process RSS/PSS, native model memory, total app speed or a global memory ceiling. Distinct concurrent replies have independent owners. Other IPC events, provider stdout, renderer work already dispatched, packaged apps and non-Linux platforms remain unmeasured. No production GC calls, Rust bridge or global runtime flags were added.

[Verification](performance/desktop-ipc-delivery-verification.json): 534 regressions pass, including eight new controller/preload cases, and the existing real desktop stream still uses deltas and releases its history. Reproduce the native comparison with `TRIBUTARY_IPC_OUTPUT=/absolute/report.json TRIBUTARY_IPC_MODE=baseline` (or `acknowledged`) and `xvfb-run -a ./node_modules/.bin/electron scripts/performance/native-ipc-delivery.cjs --no-sandbox --ozone-platform=x11`. The no-sandbox flag is limited to the disposable Xvfb fixture.

The continuation-state design is an application of the event-state discussion in [OSTEP chapter 33](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-events.pdf), not a claim that callbacks eliminate concurrency hazards. [Node backpressure guidance](https://nodejs.org/learn/modules/backpressuring-in-streams) distinguishes queue admission from eventual consumption. The installed Electron 44 types and [webContents navigation lifecycle](https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation) were checked for main-frame replacement and sender-frame ownership.


## Shared reply admission before serialization

Per-reply acknowledgements still allowed every distinct reply to create a snapshot and enter desktop IPC at once. The desktop now shares eight admission slots across full replies and deltas. Pending updates keep their existing live source and independent history ownership; delta snapshots are generated only after admission. Ready entries drain in insertion order, so an admitted reply cannot repeatedly jump ahead of older queued work. Final messages replace obsolete pending presentation states without dropping accumulated text, tool state, permissions or trace data. The limit is internal to desktop delivery, not a cap on running agents or saved conversations. VS Code keeps the helper's existing unbounded default and needs its own per-view policy.

The drain loop handles synchronous completion iteratively, including reentrant events, rather than growing a recursive stack. Failed sends cannot strand unrelated pending replies. Reload continuations obey the same eight-slot budget while clearing old patch bases; disposal releases unsent owners and prevents resurrection. Five added regression cases cover 48-reply fairness/final-state delivery, deferred snapshot access, 4,000 synchronous completions, failure/disposal and 40-reply reload recovery. The full suite passes **539 tests**.

The [Node benchmark](performance/aggregate-delivery-benchmark.json) uses three alternating subprocess pairs against `219b848`, 256 distinct synthetic replies, and preallocated source payloads. The stalled fixture transport retains actual JSON strings until explicitly acknowledged. Source allocation is excluded from the before/blocked heap difference; diagnostic GC is used only at isolated measurement boundaries.

| Median while the fixture consumer is blocked | Before shared admission | Eight slots |
| --- | ---: | ---: |
| Retained serialized packets | 256 | 8 |
| Explicit fixture JSON bytes | 8,444,342 | 263,848 |
| Post-diagnostic-GC heap increase | 13,141,992 bytes | 564,824 bytes |

The [real Electron comparison](performance/native-aggregate-delivery-benchmark.json) uses three isolated pairs and 32 distinct replies while renderer JavaScript is blocked for two seconds. Both variants use the same current preload/coalescer/UI; the baseline desktop main from `219b848` omits shared admission. Blocked submissions fall from 32 packets / 406,796 diagnostic JSON bytes to 8 / 101,688. After draining, total submissions fall from 64 / 815,310 bytes to 40 / 510,202 because unsent initial states are replaced by their full finals. Every run compares all final reply fields in the actual renderer and ends with zero history pins. The recorded end-to-drain field includes the deliberate stall and UI rendering, and is not offered as a general latency benchmark.

This is a packet-count admission bound, **not** a global RAM/byte ceiling or producer backpressure. Pending live-source count/size, acknowledged streaming delta bases, other IPC channels, provider stdout, existing renderer state and local inference remain separate owners. A single reply may be large. No conversation, tool output or active history is evicted to meet eight slots. No production GC, thread-priority change or native rewrite was added.

The reading inventory now also includes the [SEDA paper](https://www.sosp.org/2001/papers/welsh.pdf), sections 3.1–3.4 prose on stages, explicit queue boundaries, finite admission and resource controllers. The complete evaluation, figures and source implementation were not reviewed. This supports placing admission before expensive downstream work; it does not justify dropping final chat state or claiming adaptive resource control. This implementation uses a fixed cap; workload-driven sizing remains open.

[Verification and runtime availability](performance/aggregate-delivery-verification.json) records the regression result and a read-only probe of the default Unsloth, Ollama and LM Studio endpoints. All three were offline, with no models reported; this does not exclude custom endpoints or dormant installs. Native inference-memory work therefore still needs an isolated real runtime. Hardware free-memory figures are an availability sample, not a performance result.

Reproduce the subprocess experiment with `node scripts/performance/aggregate-delivery.cjs /absolute/report.json`. For the native comparison, set `TRIBUTARY_AGGREGATE_OUTPUT=/absolute/report.json` and `TRIBUTARY_AGGREGATE_MODE=baseline` or `bounded`, then run `xvfb-run -a ./node_modules/.bin/electron scripts/performance/native-aggregate-delivery.cjs --no-sandbox --ozone-platform=x11`. The fixture uses disposable profiles and makes no provider requests.


## Real CPU model memory: context allocation versus client admission

The [native inference record](performance/local-inference-benchmark.json) now measures a real model rather than a loopback response fixture. It uses the official Qwen2.5-0.5B-Instruct Q4_K_M GGUF (491,400,032 bytes, pinned publisher revision/hash) and the official CPU llama.cpp `b12110` binary (`cd959bae9`, release digest verified). No system service, app profile or existing model setting was changed. The portable runtime and model are test inputs in an owned temporary folder, not new distributable app dependencies.

Each experiment runs inside a fresh private Linux filesystem/PID/network namespace with all capabilities dropped, a clean environment, an empty home, read-only model/runtime/core mounts and an isolated writable report directory. The server listens only on that private loopback interface and uses an ephemeral API key. Two CPU compute threads, batch 128, ubatch 64, CPU layers, runtime-default F16 KV types, a disabled runtime prompt-copy cache and 16-token output limits are held constant. There is no GPU or outside-provider request.

The actual `runDirectTurn` and `LocalRequests` code drives the server through compatible chat completions. The fixture's `localRuntime: 'ollama'` value selects the existing local-client admission path; the physical runtime is **llama.cpp**, not an Ollama installation. The result does not establish native Unsloth, Ollama or LM Studio memory behavior. The warm request and four measured requests must all return successfully with non-empty generated text. No claim is made about coding quality or long-context capability.

Twelve fresh runtime processes provide three alternating-order pairs for each comparison. First, 1,024 versus 4,096 context tokens with one runtime slot and one admitted request. Second, one versus four admitted requests against the same configured total context of 4,096 tokens and four server slots (1,024 per slot). Runtime properties/slot sizes and active-slot observations are checked. All 48 measured requests, plus 12 warm requests, complete; request ownership settles, and every runtime process is stopped and reaped.

| Three-run median | 1,024 context / one slot | 4,096 context / one slot |
| --- | ---: | ---: |
| Sampled request-phase peak native PSS | 576.2 MiB | 612.4 MiB |
| Sampled anonymous PSS peak | 98.1 MiB | 134.3 MiB |
| Sampled file-backed PSS peak | 478.1 MiB | 478.1 MiB |

The smaller configured context saves about **36.2 MiB** here and also provides a shorter input capacity. This is a capacity tradeoff, not a free optimization for arbitrary project requests. It does not change product context settings automatically.

| Three-run median, four-slot server with fixed total 4,096 context | One admitted request | Four admitted requests |
| --- | ---: | ---: |
| PSS before the measured requests, after warmup | 613.4 MiB | 613.4 MiB |
| Sampled request-phase native PSS peak | 613.8 MiB | 621.7 MiB |
| PSS after all requests and 300 ms idle | 613.8 MiB | 621.7 MiB |
| Observed processing slots | 1 | 4 |

Client admission saves about **7.9 MiB** at this fixed runtime allocation, while most native memory remains owned after the requests finish. This distinguishes a client concurrency limit from model/context unload. The local setup help now explains that distinction. Weight/KV quantization alternatives, automatic unload, native-runtime lifecycle integration and native bridge overhead are not measured or implemented by this experiment.

`smaps_rollup` is sampled every 100 ms only during the four-request measurement phase, after a warm request. Sampling can miss peaks; startup maximum RSS is not measured. PSS apportions shared pages, and the file-backed portion includes mapped model and library pages. Per-field maxima can occur at different instants and should not be added as a simultaneous breakdown. Idle observations are short-term; process exit does not prove that the OS file cache was discarded. No production or diagnostic GC, allocator purge, cache-drop, mlock or system-wide runtime tuning is used in this native experiment. Node client heap, Electron RAM, GPU memory and whole-system memory are separate quantities.

The report keeps raw samples, request-result hashes, runtime logs, source/artifact hashes, slot observations, configuration and build information. The elapsed fields include controlled polling and idle waits; they are not offered as general speedup evidence. Larger models, other architectures/quantizations, GPU/unified memory, packaged applications and macOS/Windows remain open.

Primary contracts reviewed: the [pinned llama.cpp server parameters and GET properties/slots routes](https://github.com/ggml-org/llama.cpp/blob/cd959bae99ff4bed22bef2604f45241c09bbb8c8/tools/server/README.md), the exact downloaded binary's `--help`, [the publisher's model metadata](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67), and [Linux process memory accounting](https://www.kernel.org/doc/html/latest/filesystems/proc.html). These contracts support the test configuration and metric interpretation; they do not establish app-wide savings.

Reproduction: supply an absolute JSON manifest containing `runtimeTag`, `runtimeCommit`, `modelRevision`, and two `files` entries with absolute `path`, published `url`, `bytes` and SHA-256 `sha256` for the CPU runtime tarball and GGUF. Run `node scripts/performance/local-inference.cjs /absolute/manifest.json /absolute/report.json` on Linux with `bwrap`, Python 3 with safe tar extraction and the installed Node runtime. The script rechecks artifact lengths/hashes, extracts the archive safely into its own scratch directory and creates the isolated measurement environment. Downloads are separate; it never installs a service or writes model configuration.

## Bounded streaming comparison bases

The patch generator previously kept a serialized comparison copy of every tool, trace item and metadata value in every unfinished reply. Shared IPC admission limits packets being dispatched, but acknowledged comparison bases remain a separate owner. This cache now keeps at most 64 bases and an 8 MiB accounting budget, evicting the least recently updated base. The accounting charges two bytes per string code unit plus fixed structural costs; it is a policy weight, **not an exact V8 heap limit**. An individually oversized base is not retained and does not evict other useful bases. Finished messages, explicit forget and document reset still release their bases.

JSON comparison values longer than 4,096 code units now retain a length and SHA-256 signature instead of the serialized contents. Hashing uses UTF-16LE so code units are preserved; the signature prefix cannot equal serialized JSON. Actual patches still carry the original tool/metadata values. Text and thinking retain their prefix-comparison strings, subject to the shared base budget. Serialization and hashing still require transient work, and cryptographic signatures are used for equality; no model response, saved history, tool output or permission is truncated to meet the cache budget.

An eviction is a cache miss: the next update sends the complete current message and may start a new base. An oversized growing text can therefore need repeated full updates. This is an explicit memory/transfer tradeoff, not producer backpressure or a cap on conversation size. Large stable tool outputs benefit from compact signatures without triggering this fallback while their base remains cached. The same helper runs in the desktop and VS Code host; only Linux desktop native behavior was exercised here.

The [subprocess comparison](performance/patch-cache-benchmark.json) uses three alternating pairs per scenario against `5140e16`, independently random tool payloads, preallocated live source messages and diagnostic GC before/after retaining bases. It excludes source allocation from the heap difference. Every fixture applies subsequent updates with the real UI patch helper and compares all fields; final bases are released.

| Three-run median retained comparison heap increase | Before | Bounded signatures |
| --- | ---: | ---: |
| 256 replies with 4 KiB tool output each | 1,322,544 bytes | 213,040 bytes |
| 32 replies with 512 KiB tool output each | 16,886,424 bytes | 142,696 bytes |
| One reply with 6 MiB tool output | 6,383,192 bytes | 86,552 bytes |

For 32 stable large outputs and tiny text updates, the subsequent diagnostic JSON payload stays at 5,184 bytes in both variants: signatures avoid retaining the large comparison strings without resending them. Under count pressure, 448 of 512 updates fall back to full messages, increasing diagnostic update JSON from 2,185,764 to 2,201,708 bytes. This cost depends on workload and is not universally small. The fixed 64-entry/8 MiB policy is not claimed to be adaptively optimal.

Hashing also costs CPU. Initial cache creation for the 32 large-output case takes a median 26.0 ms before and 82.2 ms after in this batch fixture. Stable-output updates plus exact-result verification take 146.8 versus 235.1 ms; these fields include fixture cloning/assertions and are not isolated application interaction timings. Lifetime subprocess maximum RSS is recorded but includes source creation and verification allocations, not just retained bases. No general app speedup, startup peak, native/GPU memory reduction or total-RAM ceiling is inferred from this comparison.

The [real desktop check](performance/native-patch-cache-verification.json) drives 80 simultaneous synthetic replies through the actual host, preload, renderer and UI helper, using a disposable profile. After initial acknowledgement, the cache holds 64 entries with 53,760 accounted bytes. Pressure updates exercise full fallback; a recent reply still uses a delta. Initial, pressure, hot-delta and final states all match in the renderer, the final marker renders in chat, and final cache accounting, transport activity and history pins are zero. This is correctness/lifetime evidence, not an app-RAM measurement. No provider request or user profile change is involved.

Reproduce heap/payload comparisons with `npm run bench:patch-cache -- /absolute/report.json`. For the native check, set `TRIBUTARY_PATCH_CACHE_OUTPUT=/absolute/report.json` and run `xvfb-run -a ./node_modules/.bin/electron scripts/performance/native-patch-cache.cjs --no-sandbox --ozone-platform=x11`. The no-sandbox option is confined to the disposable Xvfb fixture. [Verification](performance/patch-cache-verification.json) records 543 passing regressions and the VS Code build. Regression cases cover LRU and byte-budget eviction, oversized/structural values, zero/invalid budgets, large tool/metadata changes, Unicode, fallback reconstruction and final release. Pending live sources, serialization peaks, producer stdout, renderer state and model memory remain separate work.
