# Owned CPU model lifecycle

## Result

Three alternating fresh-process pairs compare the same CPU model with a one-hour idle timeout against a two-second timeout. After an equal six-second observation interval, median **Hub-controller + guardian + native-server PSS falls from 666.14 to 126.97 MiB**. The within-pair differences are −534.29, −541.09 and −539.17 MiB. All 120 process-tree samples are complete.

| Component after idle | Loaded control, MiB PSS | Idle unloading, MiB PSS |
| --- | ---: | ---: |
| Native anonymous pages | 137.11 | 61.00 |
| Native file-backed pages | 477.56 | 14.65 |
| Native server total | 614.67 | 75.65 |
| IPC guardian | 11.90 | 11.92 |
| Entire measured tree | 666.14 | 126.97 |

These are independent medians and need not sum exactly. File-backed PSS reduction is not equivalent to freeing the same amount of whole-machine RAM: Linux may keep unmapped model pages in reclaimable page cache. Anonymous native PSS also decreases, by about 76 MiB in this workload. Sleep does not release every native allocation.

The next actual Hub chat reloads the model and produces a nonempty response in every case. Its median measured tree rises to 673.06 MiB. Stop reaps the native server and guardian; their PSS becomes zero by process absence. The still-running Hub controller remains at about 41.69 MiB. Neither Electron nor a GPU/driver is included in these numbers.

The memory fixture runs its controller and guardian under Node 24.21. The desktop app forks the guardian through Electron's Node mode. The later [full desktop measurement](LOCAL_ENGINE_DESKTOP.md) includes the real renderer, bridge and native model: 971.34 → 431.06 MiB total PSS after idle, with a roughly 31.7 MiB desktop guardian. The approximately 12 MiB value above belongs to the standalone Node fixture and is not claimed for every Electron/OS build.

## Product change

Settings → Connections → Set up local models → llama.cpp can start an existing `llama-server` executable with an existing GGUF file. It adds no runtime/model installer. CPU threads, context size and idle release are explicit; the UI offers 30 seconds, one minute or five minutes. Chat wakes a sleeping engine automatically. Stop and Cancel startup are available in the same panel.

The server uses one generation slot, bounded batches and no native prompt-cache RAM. Managed profiles enforce one admitted request at a time; other local chats/agents queue through the existing admission controller. Manual services keep their selected limits. Native weights and context live outside V8, so changing JavaScript heap flags or forcing its collector would not provide this lifecycle.

The private API key is supplied through a private file, omitted from public state/database plaintext and rotated on restart. Saved owned profiles retain their IDs; only those profiles are rebound. Existing external services are never stopped, unloaded or reconfigured. A stable saved port/model alias supports unchanged local resume bindings.

A small IPC guardian owns the native child. Parent IPC loss also triggers cleanup when the app is killed before JavaScript exit handlers can run. Ordinary quit waits for shutdown. A deliberately hung startup is cancelled and reaped. Engine stop rejects active generation requests and coding chats still waiting for a tool approval, including the interval after their generation slot has been released. The guardian's measured approximately 12 MiB PSS is included above; it is not hidden from the total. This pass introduces no Rust bridge, custom collector, production forced collection or package dependency.

## Source reading

Read the full author-hosted [OSTEP chapter 14, Interlude: Memory API](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-api.pdf): 12 pages, including listings, references and homework questions. Page 7 was also inspected as a rendered page. The chapter distinguishes allocator ownership from OS process reclamation and explains why retained references remain a problem with garbage collection. Its homework/Valgrind examples were not executed, and the linked books were not read. [Reading provenance](local-engine-reading.json) records the PDF hash and exact scope.

Read the full [Sleeping on Idle section](https://github.com/ggml-org/llama.cpp/blob/cd959bae99ff4bed22bef2604f45241c09bbb8c8/tools/server/README.md#sleeping-on-idle), plus targeted API/flag documentation, at the pinned runtime commit. It specifies model/KV unloading, automatic task-triggered reload and the `/props`, `/models`, `/health`, `/metrics` exemptions. The implementation uses native `/models` and `/props` for metadata. Ten catalog reads in each native case leave its sleeping state unchanged. This is targeted maintainer-source reading, not the whole repository or every memory-management book.

## Evidence and reproduction

- [Native CPU memory](local-engine-memory.json): llama.cpp `b12110`, commit `cd959bae99ff4bed22bef2604f45241c09bbb8c8`; Qwen 2.5 0.5B Instruct Q4_K_M at pinned revision `9217f5db79a29953eb74d5343926648285ec7e67`. The archive/model sizes and SHA-256 values are checked before execution. Each fresh private namespace uses 4,096 context tokens, two CPU threads, one slot, 16 output tokens per turn and five samples per boundary. It runs the actual Hub start/connect/send/sleep/wake/stop path, with no forced GC. Source hashes match before and after.
- [Bundling](local-engine-bundles.json): restoring only the two setup UI files to `ffce876` changes the cold-chat static closure by **0 bytes**, while final shipped JavaScript grows by 4,474 bytes. Setup stays behind the existing Settings import. This is a byte audit, not a startup/paint/heap benchmark. A fresh Node check also confirms Hub construction and stopped-state inspection do not import or instantiate the engine manager.
- [Desktop UI](local-engine-ui.json): five grouped Linux Electron checks use the actual Hub, guardian, authenticated streaming API and real bridge. Model output is synthetic, the idle clock is accelerated, and file-picker return values are controlled. They cover start/chat, one-slot controls, sleeping status, a 390 px layout, cancellation, stop/restart/profile identity and app quit. Screenshots were inspected: [sleeping](local-engine-sleeping.png), [narrow](local-engine-narrow.png).
- [ASAR](local-engine-asar.json): the actual Electron Node runtime loads the helper from a synthetic archive with the guardian unpacked, starts its child and reaps it. It is not a complete installer test. The distribution verifier now includes this path for future packaged builds.
- [Verification](local-engine-verification.json): focused ownership/service/admission tests, TypeScript and production UI/extension builds. Parent SIGKILL cleanup uses a synthetic native child. A coding-agent approval pause uses a trusted temporary project; personal workspaces correctly disable command tools.

The final full regression run passes **597 tests**, with no failures, cancellations or skips. The final focused ownership/service/admission run passes 22 tests. Native CPU measurements completed before that final test run; builds and regression suites did not overlap the memory experiment.

Run `node scripts/performance/local-engine-memory.cjs /absolute/artifacts.json /absolute/report.json` on Linux with bubblewrap after stopping other tests/builds. The artifact manifest uses the report's pinned artifact metadata plus an absolute `path` for each locally downloaded file. Run `node scripts/performance/local-engine-bundles.mjs /absolute/report.json` separately. Native UI/ASAR fixtures are in `test/e2e/local-engine-ui.cjs` and `test/e2e/local-engine-asar.cjs`.

The first Python model transfer was explicitly terminated after curl's independent range diagnostic responded; a later timed-out curl transfer was resumed from its partial file. Only the final complete size/hash-verified artifacts supplied the six reported cases. Earlier missing temporary results are not used. File-picker and composer timing assumptions in the UI fixture were corrected before its final successful run.

## Still open

This standalone fixture measures one small CPU model, retained process PSS at explicit boundaries and normal sleep/wake. Combined Electron/model memory is covered by the [desktop follow-up](LOCAL_ENGINE_DESKTOP.md). Neither experiment proves peak memory, natural GC latency, universal inference throughput, coding quality, GPU/VRAM behavior, other runtimes or native Windows/macOS packaging. Reload has a cost. Full transcript-body virtualization, other React/store lifetimes, dirty/undo budgets and broader model memory controls remain open under the overall optimization goal.
