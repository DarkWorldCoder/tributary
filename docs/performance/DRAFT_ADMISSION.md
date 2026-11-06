# Recovery-save memory and admission

## Ownership change

The renderer previously submitted every debounced recovery snapshot even when older bridge calls were still waiting. The file snapshot contains the complete open-tab list, every dirty file's current text, its original disk text and its modification time. Slow acknowledgements could therefore leave many large copies in flight. The composer uses the same writer.

Normal operation now admits one save per writer. While it is pending, later complete snapshots replace the unsent pending value. The latest 400 ms typing debounce is still honored. Acknowledgement or failure re-checks current state and admits a ready successor. Other writer keys remain independent. There is no truncation, document eviction, history clearing or new runtime dependency.

Page departure and exit flushing are deliberately exceptional: the final pending snapshot or deletion is submitted immediately behind the active call, before its acknowledgement. Waiting would strand the final data when the renderer document disappears. Each departure notification may submit an extra final operation; it is outside normal admission. A cached document can resume saving after pagehide; only explicit disposal makes its owner terminal. Calls are invoked synchronously in submission order; `Hub.saveDraft` and the private atomic-file replacement remain synchronous. This contract would need an ordered host queue if that host API became asynchronous. Recovery does not save editor undo history across app restart.

The limit is per writer and counts operations, not exact heap bytes. A single snapshot can still be large; many open projects own multiple writers. Existing 16 MiB per-draft, folder-size and expiry policies are unchanged. This does not bound all app RAM, dirty editor/undo states, active documents, model allocations or other IPC channels.

## Evidence and interpretation

Two separate experiments use fresh source Electron apps, temporary profiles/files and the real editor, renderer writer, preload and private draft storage:

- **Controlled slow receiver:** the fixture temporarily holds `saveDraft` operations before releasing them FIFO. It samples main heap and the Linux process tree without forced GC, and records main-process `perf_hooks` GC events. This identifies retained snapshot pressure under a deliberately slow bridge; it is not physical-disk latency.
- **Actual main event-loop stall:** the renderer independently types twelve revisions while the real main process sleeps for 6.5 seconds. Recovery storage is unchanged; only call counting is added. A separate parent samples descendant PSS while main cannot decode queued IPC. This checks the actual Electron transport queue, rather than inferring it from the controlled receiver.

Each experiment uses three serial fresh pairs for one small draft and six 400 KiB dirty text files. Pair order is reversed for the middle repetition. Production sources and complete UI builds are hashed before/after each case. No builds, tests or other agent-run benchmark overlap these measurements. There is no debugger or forced collection. Accepted procfs samples require complete process-tree identity/accounting; rejected attempts stay in the raw report.

Sampled maxima are the largest observed values, not continuous memory peaks. PSS apportions shared pages and excludes the sampler, X display server and allocations outside the descendant tree. GC event durations describe the main process only; they are not exact stop-the-world pauses, renderer GC or evidence of universal responsiveness. No GC flags or custom collector are added.

The fixture verifies undo/redo before navigation, final snapshot transmission without waiting for the blocked call, exact dirty text and original disk bases in the private recovery store, and reopening every file in the actual editor. A final edit is given 100 ms to reach React's draft owner before navigation. An exploratory attempt that navigated immediately exposed the existing React-owner scheduling window and is not included in the final aggregate; a keystroke that has not reached the writer is outside its final-flush guarantee. Crash recovery still has the existing debounce/commit window and no new fsync guarantee.

## Results

All figures below are medians across the three fresh runs of each variant. The six-file case uses six 400 KiB dirty text files; these are stress workloads, not typical short messages.

| Six-file metric | Before | Admission |
| --- | ---: | ---: |
| Controlled receiver: sampled main JS heap peak | 87.52 MiB | 27.08 MiB |
| Controlled receiver: sampled app-tree PSS peak | 505.11 MiB | 430.93 MiB |
| Actual main stall: sampled PSS while main is blocked | 409.26 MiB | 413.73 MiB |
| Actual main stall + recovery drain: sampled PSS peak | 438.04 MiB | 414.24 MiB |
| Actual recovery drain: full-snapshot saves | 12 | 2 |
| Actual recovery drain: private-file bytes written | 56.66 MiB | 9.44 MiB |
| Actual recovery drain: synchronous save work | 141.37 ms | 25.79 ms |
| Actual drain: first write start to last write finish | 218 ms | 41 ms |
| Cold-chat minified / gzip JS increase | — | +228 / +99 bytes |

The main-stall-only numbers do **not** establish lower RAM while main is blocked. The reduction appears during the real recovery-write burst: every accepted sample in both stall and drain phases is included in the full-window peak. The three signed full-window PSS differences are −29.80, −14.18 and −24.31 MiB. The input report retains blocked-only values, all observations and rejected attempts, rather than selecting a favorable phase/repetition away. [Complete window analysis](draft-work-window.json) · [Actual main-stall samples](draft-main-stall-memory.json).

Small controls do not establish a RAM saving: their full-window PSS growth is approximately 6.92 → 6.96 MiB, with mixed signed differences. They do reduce repeated recovery-file writes. Before-phase footprint also varies, so the absolute small-case peak difference is not attributed to the helper. No general startup, paint, throughput or everyday RAM improvement is inferred.

The controlled receiver has 809 accepted complete process samples and one rejected attempt; the actual main-stall experiment has 801 accepted samples and three rejected attempts. All 24 final apps preserve complete dirty text, original disk bases and actual recovery/reopening. Controlled-receiver checks also preserve live undo/redo. [Controlled raw samples](draft-admission-memory.json) · [Reopened workspace](draft-recovery.png).

Main-process GC totals do **not** show an established improvement: in the controlled six-file case, median recorded event duration is 6.62 → 7.45 ms, with mixed per-pair differences. Those events include observation overhead and do not measure renderer or exact stop-the-world pauses. No forced GC occurs in either experiment. Natural GC pause analysis remains unfinished.

The clean temporary-build audit adds 228 minified JS bytes / 99 gzip bytes to cold chat, with the same 228-byte increase in total shipped JavaScript and no new dependency. CodeMirror/viewer/local-setup modules remain outside cold chat. [Bundle audit](draft-admission-bundles.json).

## Reading and validation

Read the complete author-hosted OSTEP chapter 30 (19 pages, 6,423 locally extracted words), including examples, traces, references and homework prompts; rendered pages 13–14 were inspected. Its explicit capacity/state checks inform the asynchronous admission design; this does not transplant pthread locking into JavaScript. Homework programs and linked papers were not executed/read. The WHATWG PageTransitionEvent.persisted interface was read selectively to preserve cached-document lifetime. [Reading scope](draft-admission-reading.json).

Reproduce with the frozen baseline desktop/UI at `0a29544` and matching current core/dependencies:

```
npm run bench:draft-memory -- /absolute/baseline-host /absolute/report.json
npm run bench:draft-main-stall -- /absolute/baseline-host /absolute/report.json
npm run bench:draft-bundles -- /absolute/report.json
```

All 607 regressions, 12 focused draft tests, 15 existing native split-editor checks, TypeScript, the production UI build and the VS Code bundle build pass. [Verification](draft-admission-verification.json) · [Exploratory audit](draft-admission-exploratory.json). Focused tests cover coalescing, final deletion, synchronous/asynchronous errors, debounce, reentrancy, independent keys, pagehide and cached-document continuation.

Each native child uses an isolated virtual X display. The fixture's `--no-sandbox` is confined to that disposable test process. Native Windows/macOS, installed builds, browser back/forward caching, real physical-disk stalls and general leak freedom are not certified here. The original memory-efficiency objective remains active; durable dirty/undo working-set budgets, full natural-GC pause analysis, GPU/VRAM and additional model/runtime cases remain open.
