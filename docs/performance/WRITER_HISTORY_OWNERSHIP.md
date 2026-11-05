# Saved writer histories: measured working set and ownership audit

Checked 4 November 2026. The original baseline and ownership audit below are retained for comparison. Owner-aware writer release is now implemented locally; the later verification section records its measured scope.

## Measurement

`npm run bench:writers -- --output docs/performance/writer-working-set-baseline.json` seeds 32 synthetic SQLite chats, each with 64 long replies/tool logs. Each isolated worker copies the database. View cases read transport snapshots; writer cases load live history and persist one completed synthetic reply per visited chat. Original payload counts and reopening of saved replies are verified. Diagnostic GC runs at stated boundaries only; the production app does not gain a GC call.

| Visited chats | View-mode loaded histories | View post-GC heap delta, bytes | Writer-mode loaded histories | Writer post-GC heap delta, bytes | Retained writer message JSON bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4 | 0 | 89,360 | 4 | 9,633,616 | 9,391,424 |
| 16 | 0 | 96,560 | 16 | 38,136,272 | 37,566,470 |
| 32 | 0 | 96,560 | 32 | 76,049,264 | 75,134,230 |

The 32-chat writer case retains 76,049,264 additional heap bytes in this run. Read-only snapshot use leaves writer histories unloaded. Heap deltas include measurement noise and can be negative; these are current-policy observations, not a before/after cache-eviction result. The synthetic writer calls are not complete real agent turns.

The read-only 32-chat burst has only 96,560 additional live heap bytes, but its reported `new_space` has 67,108,864 physical bytes with 12,480 used bytes. Standalone process PSS is 94,726 KiB versus 17,354 KiB before visits. This exposes V8 heap commitment beyond live objects; it does not prove that every extra PSS page belongs to that space. The yielded-per-view case still retains 86,370 KiB of process PSS in this run. A short idle sample and diagnostic SQLite `shrink_memory` did not materially remove the observed working-set cost. No global V8 heap flags, periodic GC or production SQLite shrink policy follow from these observations.

[Node V8 statistics](https://nodejs.org/api/v8.html#v8getheapstatistics) distinguish used object bytes from heap commitment. Heap-space names/order can change with V8 versions, so the report preserves the observed names and runtime. [SQLite's shrink-memory pragma](https://www.sqlite.org/pragma.html#pragma_shrink_memory) requests connection memory release; this experiment is not an exact PSS attribution or proof that SQLite never retains memory. Forced diagnostic collection and a tight burst differ from natural UI pacing; the yielded case is only an additional comparison. PSS here is one standalone Node process, not the Electron tree, GPU or a model runtime.

## Source-grounded ownership constraints

| Path | Current evidence | Requirement before eviction |
| --- | --- | --- |
| `SqliteStore.lazy/loadMessages/readThread` in [store.js](../../core/store.js) | Reading a writer's `messages` installs a strong array on the thread. Read-only snapshots do not do so. Already-loaded writers return their live objects. | Preserve exact live message identity while a writer owns it. Rehydrate from durable SQLite only after a verified clean release. |
| `SqliteStore.collect/flush` | Loaded-message row fingerprints live in `snap`; a full flush interprets missing collected rows as removals. | Dropping an array while leaving its fingerprints can delete persisted rows on the next full save. Eviction must reconcile fingerprint ownership and deletions atomically, not just replace `messages` with an empty array. |
| `save/flushPending/sync/apply` | Pending edits may be message-scoped; external changes reconcile per-row fingerprints and local dirty state. | Flush required rows, preserve explicit removals, invalidate stale summaries and retain local-writer precedence. Reopening after another process's update/delete must be tested. |
| `Hub.withTurn/sendReserved` in [hub.js](../../core/hub.js) | The running map spans the awaited turn. Events and final persistence still use the message object. | Pin the history across completion, cancellation and error cleanup; release after durable settlement rather than just after a status change. |
| `Hub.runTeam` and [manager.js](../../core/manager.js) | Team state spans multiple role turns and a parent manager summary is updated while child tasks run. | Pin the parent between steps as well as each active worker. A gap between individual turns is not idle history. |
| `judgeRace` in [manager.js](../../core/manager.js) | It captures a race message, awaits a separate `hub.send`, then writes the original race's judgment. | An inner turn finishing must not unpin the outer operation's message. Require independent nested ownership. |
| `Hub.runVerify` | It captures a message before an awaited root lookup; `verifyRuns` is registered later. Its result setter mutates that same message. | Pin before the first await, not merely while the verify-run map contains an entry. Release on all abort/error/result paths. |
| `restoreCheckpoint/turnFolder/conversationDiff` | Asynchronous file/repository work uses previously selected thread/message objects; restore later updates notices. | Audit both mutating and read operations for retained references and storage reconciliation. Keep checkpoint changes and notices associated with the original message. |
| Desktop patch transport in [main.js](../../desktop/main.js) and [message-patch.js](../../core/message-patch.js) | Pending coalescing timers hold a message; a full final event clears the timer and completed patch snapshots are removed. | Store eviction does not instantly free separately held transport snapshots. Verify the actual final-event path and pending event ownership. |

This table is an initial audit, not an exhaustive proof for every public API, plugin or fire-and-forget path. Simply protecting `hub.running`, using an LRU by itself, or replacing arrays with WeakRefs is insufficient: an async operation can keep an individual message while no longer keeping its parent array. A cache rewrite must first introduce balanced operation ownership across the full emitter/request/caller paths.

## Verification requirements tracked by this audit

- Overlapping and nested same-chat operations; manager/worker gaps; delayed verify/checkpoint/race judgment; abort/reject and late callbacks.
- Unsaved scoped and unscoped edits; explicit message/thread deletion; full save after release; reopen with exact output, tool results, model/session metadata and ordering.
- Concurrent external updates/deletes and local dirty precedence, including the interval between saving, releasing and reloading a history.
- Transport replies and pending patch timers; active UI views; CLI and VS Code consumers; JSON-store fallback.
- Actual repeated agent workloads, main-process heap retainers and process-tree memory under sustained UI activity. Report reload/serialization latency and memory separately.

Terminal GPU/scrollback and live preview iframes remain separate working-set owners. Active preview page state is intentionally not evicted by this audit. The small preview cleanup in this pass removes closed-tab revision counters and cancels navigation aimed at a closed pending-start tab; it does not unload an open iframe or bound the module-wide project-session metadata cache.

## Implemented ownership and persistence rules

- `core/history-cache.js` tracks independent async operations and every active ancestor. A child finishing does not release its parent's reference; a detached child owns its history after the parent returns. The grace interval is 1.5 seconds after the last owner releases, not a global periodic sweep or an arbitrary history-count LRU.
- `Hub` gives each history-using async entry its own scope. Desktop IPC and VS Code request/reply handling cover their complete operations; the VS Code reply scope waits for `postMessage`. Newly loaded histories participate in the same ownership accounting. Direct mutable access outside a scope remains pinned for compatibility; default CLI/SDK Hubs and the JSON fallback retain their earlier semantics.
- `SqliteStore.releaseMessages` refuses pinned/unmanaged histories, saves the complete candidate and pending wider edits, then drops its message fingerprints and restores the lazy descriptor. A later full save cannot misinterpret lazy messages as deletions. Explicit message/thread deletions still persist. A failed write retains both live objects and fingerprints; one failed idle batch defers remaining candidates rather than retrying a locked database for every chat.
- `core/message-delivery.js` unifies desktop/extension coalescing. Its timer owns the message independently. A final full event cancels the timer; asynchronous webview delivery retains the lease until settlement; disposal clears queued updates. Completed patch snapshots retain their existing cleanup.
- Delegated workers explicitly own their parent message through final publication, even after the parent's turn and local command bridge close. Team gaps, nested race judgment, verification before root lookup and checkpoint notices keep their original live message objects.
- Closing a store closes the cache, cancels its idle timer and disables the async-context tracker. Future operations cannot reopen cache ownership. No production `global.gc()`, V8 heap flags or native-language bridge were added.

`withHistoryOperation` is an ownership boundary, not a generic transaction: it preserves synchronous return values, releases on sync/async errors, and propagates IDs to active ancestors. Future fire-and-forget code that retains mutable messages must establish its own operation before returning; a parent scope alone cannot cover a later callback. New host transports must retain ownership through serialization. These contracts remain explicit rather than claiming safety for unknown third-party callbacks.

## Verification on the implementation

`test/history-cache.test.js` contains 14 checks: scoped pending edits and removals; full save/reopen ordering and metadata; nested/overlapping owners; detached children crossing inactive scopes; unrelated idle chats; sync/async failure; external edits/deletes and local precedence; failed save/retry; direct mutable and JSON compatibility; coalesced/async transport settlement; verification/race nesting; real CLI team gaps; checkpoint/untrusted-check persistence; delegated completion after parent close; retry batching; and late callbacks after close. Some checks cover several related cases. The full suite currently passes 484 tests. Tests do not prove all future integrations or model-runtime memory.

`npm run bench:history-cache -- --output docs/performance/history-cache-benchmark.json` runs three alternating standalone-process pairs over 32 saved chats, with 64 long replies/tool logs each. Each chat receives an actual Hub turn through a deterministic local CLI; no external model is contacted. It records natural idle and diagnostic-GC samples, turn latency, reconstruction-plus-hashing latency, exact saved payload/session parity and a full save after release. It compares compatibility retention against the same source with managed histories enabled. Cold reads can be slower after release; this tradeoff is retained in the raw report.

The actual Electron desktop harness, `scripts/performance/native-history-cache.cjs`, uses the real request/event/UI path and disposable profiles. It replaces discovery with the same local fixture CLI, leaves the real desktop cache configuration otherwise intact and samples the identity-checked Linux process tree. See [compatibility](native-history-compatibility.json) and [managed](native-history-managed.json):

| Native sample | Compatibility retention | Managed histories |
| --- | ---: | ---: |
| Loaded writer histories after idle | 32 | 0 |
| Main used heap before turns, bytes | 5,192,856 | 5,053,380 |
| Main used heap after natural idle, bytes | 81,810,816 | 93,619,504 |
| Main used heap after diagnostic main GC, bytes | 81,751,812 | 6,259,204 |
| Natural-idle process-tree PSS, KiB | 1,097,088 | 667,647 |
| Process-tree PSS after diagnostic main GC, KiB | 911,892 | 601,791 |

Both native runs verified all 32 saved chats, message counts and session payloads after a full save/reopen. Both reported a complete six-process tree, a ready chat UI and no horizontal overflow. No renderer collection was forced. These are one native run per mode under Xvfb, not a repeated production/hardware-GPU distribution; other validation work ran on the shared host during part of the managed run. Do not infer a general speedup from native elapsed time. The lower native PSS is an observation for this pair, not a claim that every changed page belongs to the cache.

The natural managed heap being larger than its post-GC live set is deliberate evidence of the boundary: making arrays unreachable does not itself force immediate V8 collection or return every committed page to the OS. The diagnostic flag belongs only to the measurement harness. Installed model weights/VRAM, Windows/macOS native behavior, long interactive pressure, terminal GPU/scrollback and retained preview sessions remain separate work; this pass is not a completion claim for the broader memory goal or an installer release.

## Final standalone paired summary

The final three alternating pairs retained a median 77,259,192 versus 1,277,480 additional heap bytes after diagnostic collection. Median workload elapsed time was 6.20 versus 5.14 seconds for these local-CLI turns. These are workload measurements, not inference speed or an isolated cache-management microbenchmark. Final per-process source fingerprints, cold-read timings and individual run variability remain in the raw JSON.
