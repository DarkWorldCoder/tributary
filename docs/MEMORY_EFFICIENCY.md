# Memory efficiency

- **Native storage:** Node/Electron’s built-in SQLite engine stores history on disk. An additional Rust memory bridge is not required for this storage path.
- **Small sidebar cache:** badges retain status flags, not copies of replies, thinking, logs, images or diffs. Native SQLite iteration reads the newest messages without first loading every message ID.
- **Read-only history snapshots:** desktop and VS Code chat views read historical messages without retaining them as main-process writer state or message fingerprints. Active/local writers still use their live objects, including unflushed edits. Those writer histories remain resident; the renderer also holds its selected chat.
- **Saved-document cache:** clean hidden document copies are released when selection changes or the panel closes. The visible document and every unsaved draft remain. Reopening a clean document fetches its current saved version.
- **Bounded context:** project memory stays below 256 KB. Retrieval selects relevant excerpts within its configured character budget. Search now walks each short memory line once instead of allocating a copy of every query term for every line.
- **Local models:** inference and weights stay in Unsloth/Ollama/LM Studio. Compact local profiles limit previous-chat context to 4,000 characters and enabled project-memory excerpts to 2,000 characters. Original data is preserved. Local coding tool results are bounded, older complete tool groups are evicted from the active request, and each turn has a step/tool limit. These limits reduce context growth; model weight size is controlled by the external runtime.
- **Local request admission:** local chats and built-in local coding agents share a cancellable FIFO queue per loopback service in this process. One generation request is admitted by default; Settings and local-model setup offer 1, 2 or 4. Each service keeps at most 64 waiting requests, and idle pools release their entries/listeners. Each tool round releases its generation slot before executing tools or waiting for approvals. Other apps, external coding CLIs, runtime-reserved KV cache and weights remain outside this queue.
- **Streaming saves:** message-scoped dirty tracking skips serialization of unchanged messages in the active conversation. Unspecified edits still use full comparison, and broader pending saves take precedence. External writers and deletions keep the existing SQLite merge behavior.
- **Stream framing:** agent stdout scans only new chunks for delimiters and assembles a complete line once. Fragmented long JSON frames keep their full contents. Diagnostic stderr bypasses line framing: ACP/Codex sessions keep a 2,000-character tail and the generic runner keeps 4,000 characters, even when a process never prints a newline.
- **SSH output and lifetime:** remote commands enforce the configured byte limit on each of stdout and stderr, matching the local executor's per-stream contract. Port-forward startup keeps an 8,192-character diagnostic tail, then releases its collector, readiness listeners, retry and deadline work; subsequent logs are drained without retention.
- **Browser worker lifetime:** language assistance expires after 60 idle seconds; the browser formatter expires after 30. A shared client posts one request at a time, bounds waiting requests, cancels obsolete completion/validation/outline work, and releases worker listeners and webview blob URLs. Editor text and undo history remain in the editor. Late asynchronous startup cannot revive a disposed worker. Native desktop checks covered two language-worker expiry/restart cycles, dirty text, undo/redo and working diagnostics; these do not measure total application RAM.
- **Language-server ownership:** visible editor panes acquire separate document leases. Hidden panes release theirs without unmounting CodeMirror or losing drafts/undo. Shared documents remain open for other owners, and admitted formatting/navigation/completion operations keep their resources until settlement. The last owner/operation releases the document and unused server process. Closed tokens cannot reopen it, and released metadata is removed rather than retained as generation tombstones. Desktop renderer replacement/crash and disposed VS Code views release their ownership too.
- **Load features when used:** Settings, Agent teams, Project room and saved documents load on first open. Read-only file and memory previews do not import the editor engine. Once opened, feature components remain mounted so deferred loading does not discard unsaved drafts or working sessions.

See [research and remaining work](MEMORY_OPTIMIZATION_RESEARCH.md) for the source inventory, implementation decisions, benchmark limits and unfinished retention work.

## Reproduce the sidebar benchmark

Run `npm run bench:memory`. It creates disposable history and compares the previous and optimized sidebar caches in separate processes with explicit garbage collection. No real user conversations or local models are opened.

The recorded [benchmark result](performance/memory-summary-benchmark.json) uses 32 conversations with large replies, tool logs and diffs. The serialized retained cache decreased from **19,973,731 bytes** to **4,717 bytes**. All 32 conversations stayed unloaded, with full messages still available in SQLite.

This measures the **sidebar cache**, not total app RAM, model weights or GPU memory. Heap deltas are noisy and may be slightly negative after garbage collection. Electron/GPU resources and active model inference have separate costs; this result is not a claim of 99.98% lower total RAM.

## Reproduce streaming and bundle measurements

```sh
npm run bench:stream -- --output docs/performance/stream-store-benchmark.json
npm run bench:bundles -- --output docs/performance/bundle-benchmark.json
npm run bench:retention -- --output docs/performance/retention-benchmark.json
npm run bench:proc -- --output docs/performance/proc-stream-benchmark.json
npm run bench:local-requests -- --output docs/performance/local-requests-benchmark.json
npm run bench:lsp -- --output docs/performance/lsp-framing-benchmark.json
npm run bench:terminal -- --output docs/performance/terminal-flow-benchmark.json
npm run bench:writers -- --output docs/performance/writer-working-set-baseline.json
```

Streaming uses disposable SQLite histories and separate Node processes; it checks persisted output parity and observes natural GC during measured batches. Forced GC only establishes its initial measurement baseline, never runs in the app. Bundles builds historical import boundaries and current boundaries using the same installed dependencies, then follows each complete static dependency closure. The historical reference must exist locally. Neither benchmark opens user data or invokes a model.

The retention experiment separately measures 32 historical chat views and a 40-document cache, each in isolated old/new policy processes. Read-only view snapshots retain no writer message bodies; the document fixture retains the current clean copy plus its two dirty drafts. Fresh SQLite parsing on repeat reads is a deliberate memory/latency tradeoff. See the raw report and research record for measured heap deltas and limits.

The process-stream experiment checks ordinary short messages, fragmented large frames, and a long unterminated diagnostic stream. It compares the previous and current policies in separate Node processes, verifies output checksums, and records natural GC and open-stream retention. It excludes complete agent parsing, transport IO, Electron process memory and model generation time. These are allocation/framing improvements, not a claimed whole-app speed multiplier.

The local-request experiment sends 24 real HTTP requests to a disposable server, with a fixed reply delay. The low-memory setting reduced overlapping received JSON bodies from 24 (1,538,976 bytes) to 1 (64,124 bytes); 2 and 4 matched their selected caps. All replies completed, and idle queue counts returned to zero. Queueing also increased elapsed completion time in this fixture. These bytes are request payloads, not measured inference RAM, model weights or VRAM.

The [worker lifecycle record](performance/worker-lifecycle-verification.json) contains native worker-isolate heap samples and source fingerprints. To sample your own disposable test app, launch it with a loopback remote-debugging port, then run `node scripts/performance/worker-heap.cjs <port> [output.json]`. The probe detaches after each sample and does not force GC. A missing worker target establishes termination of that worker, not a matching reduction in process RSS or release of editor caches. The host formatter is a separate resource; the browser formatter's lifecycle is covered by the shared-client tests.

The [language-owner record](performance/language-owner-verification.json) covers shared-view races, pending formatting, metadata cleanup, desktop project/tab switching and renderer reload. Native checks used a real child process running a deterministic LSP fixture. They establish process cleanup and preserved editing state, not the memory/indexing cost of actual language servers. Restarting a server can require reindexing; whole-app RAM and real-project cold-start latency still need measurement. Run `node --test test/language-tools.test.js test/vscode.test.js` after `node vscode/build.js` for the corresponding integration checks.

## Native process-tree measurements

The [native retention experiment](performance/process-tree-benchmark.json) uses six projects, six 2,500-line TypeScript files and six saved 24-message chats. In the corrected repeated workload, renderer heap medians were 27,896,876 and 27,909,044 bytes; DOM counters stayed at 8,894. Seven observed Electron processes remained. Idle process-tree PSS returned close to its already-warm baseline after the language worker expired. This is one synthetic Linux/Xvfb working-set test, not proof of universal leak freedom or an old/new app RAM comparison.

The initial apparent DOM growth came from the browser observer retaining closed search-dialog elements through DevTools console handles. A separate console-clear request alone did not release those references; disconnecting the automation observer did. Corrected samples disconnect it, discard test console entries, explicitly collect the renderer for measurement, and detach the sampler afterward. Application code does not force GC or clear the user's console.

Reproduction tools:

- `node scripts/performance/native-retention-fixture.cjs /tmp/tributary-fixture.json` creates only disposable synthetic data. Launch the source app using the returned profile and a loopback debug port; no provider needs to run.
- `node scripts/performance/app-memory.cjs <app-main-pid> [output.json]` reads Linux procfs. Use the actual Electron main PID, not the automation daemon PID. It reports PSS, private clean/dirty memory and RSS separately; changed/missing process samples have null totals.
- `node scripts/performance/renderer-heap.cjs <debug-port> [output.json] [--gc] [--clear-console]` samples the renderer. GC and console cleanup are opt-in diagnostic boundaries. Disconnect other debugging/automation clients first when comparing retained DOM objects.

Warm all six saved chats and editors, end on the same project, take five paired samples, repeat the same six visits twice, then sample after the worker idle deadline. Keep dirty drafts, active tools, terminal/preview sessions and real model loads as separately measured workloads. Procfs snapshots are not atomic, shared pages are apportioned by PSS, and detached helpers/external model runtimes/GPU-driver allocations outside readable descendants are excluded.

## Bounded language-server input

The stdio language-server reader bounds headers to 8 KiB and each body to 8 MiB, preserves valid UTF-8 across byte boundaries, and grows storage only as bytes arrive. Complete contiguous responses avoid an extra owned-body copy. Small unfinished tails use dedicated allocations so they do not retain a large completed batch or the shared Buffer pool. EOF, invalid frames and pane/session cleanup release pending requests and protocol buffers. This does not set a total RAM limit or change the runtime collector.

The [framing benchmark](performance/lsp-framing-benchmark.json) separates checksum/copy audits, isolated parsing timings and post-GC tail retention. It excludes JSON parsing and actual language-server IO; see its scope before using the numbers. The [research record](MEMORY_OPTIMIZATION_RESEARCH.md#language-server-byte-framing-and-retained-transport-buffers) links the official protocol and Buffer references and documents the remaining limits.

## Preview lifecycle

A preview cannot start after its startup has been cancelled, including during project environment preparation. Stop-all cancels pending starts as well as running children. Finished previews clear their output listeners, coalescing timers and child references; bounded stopped-preview metadata remains available to the UI. Output preserves valid UTF-8 across read boundaries on each pipe. See the [lifecycle evidence](performance/preview-lifecycle-verification.json) for actual-process checks and remaining limits. This preview-specific change does not establish a whole-app RAM reduction; desktop terminal producer backpressure is documented separately below.

## Terminal output pressure

Desktop terminals now pause fast producers when xterm falls behind and resume after parsed output is acknowledged. Transport text and packet counts are bounded; an already-delivered native read may overshoot the text watermark. Hidden mounted terminals continue parsing. Reload adopts the existing shell and unacknowledged output rather than starting a duplicate shell; previously parsed scrollback is not reconstructed.

The [terminal verification](performance/terminal-flow-verification.json) records exact 4 MiB PTY checksum parity, a native high-output/hide/reload/interrupt test, zero transport data after settling, and 465 passing regression tests. Queue counters are not a whole-app RAM benchmark. Many-terminal, scrollback/GPU, packaged and cross-platform memory measurements remain unfinished.

## Current writer-history working set

The [writer baseline](performance/writer-working-set-baseline.json) measures saved histories after completed synthetic updates. At 32 chats, writer arrays still retain roughly 76 MB of live heap. Read-only snapshots avoid that ownership, but their transient allocation burst can leave substantial V8 heap capacity committed even after objects are collected. Diagnostic SQLite shrink is not a demonstrated production remedy. These are standalone Node measurements, not Electron or model RAM.

The [ownership audit](performance/WRITER_HISTORY_OWNERSHIP.md) records the implementation and its ownership requirements. Active turns alone are not enough to identify safe eviction: delayed verification, nested judgment, checkpoint work, transport timers, dirty fingerprints and external updates also matter. The baseline itself did not enable eviction. The current local desktop and VS Code hosts now release saved writer histories after their final operation/transport owner ends; see the audit for exact persistence tests and native measurements.

The [paired workload report](performance/history-cache-benchmark.json) and native [compatibility](performance/native-history-compatibility.json)/[managed](performance/native-history-managed.json) samples keep natural idle, live heap after diagnostic collection and process-tree PSS distinct. In the native fixture, completed writer arrays went from 32 retained histories to zero. Main used heap after diagnostic collection was 81,751,812 versus 6,259,204 bytes. Production collection remains automatic. This is a synthetic local-CLI workload, not a model/inference or cross-platform memory guarantee.
