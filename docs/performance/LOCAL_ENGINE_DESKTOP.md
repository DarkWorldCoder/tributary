# Local model memory in the actual desktop

The earlier [CPU lifecycle experiment](LOCAL_ENGINE.md) measured a Node Hub controller. This follow-up runs the source **Electron desktop**, its real renderer/composer/bridge, the Electron Node-mode guardian and the same pinned native CPU server/model.

## Measured result

Three alternating fresh-process pairs compare a one-hour idle control with two-second native idle release. Each app sends two real UI messages, capped at 16 output tokens per response. After the first response, both variants wait six seconds. Median whole measured desktop-tree **PSS decreases from 971.34 to 431.06 MiB** at the idle boundary. Within-pair differences are −539.76, −538.69 and −542.15 MiB.

| Settled boundary | Loaded control, MiB PSS | Idle release, MiB PSS |
| --- | ---: | ---: |
| Desktop before model setup | 291.29 | 290.37 |
| After first generation | 995.35 | 994.30 |
| After equal idle interval | 971.34 | 431.06 |
| After model-picker/catalog reads | 985.35 | 446.75 |
| After next generation | 1004.63 | 998.76 |
| After stopping the engine | 375.44 | 366.68 |

At idle, the native server alone is **614.91 → 76.13 MiB PSS**. Native anonymous pages decrease **137.12 → 61.03 MiB**; native file-backed pages decrease **477.78 → 15.11 MiB**. These are independent medians, so components need not sum exactly. Unmapped file pages can remain in Linux's reclaimable page cache: this is a process-tree saving, not a claim that the same amount of whole-machine RAM became free.

The actual desktop guardian is about **31.7 MiB PSS** in the sleep-enabled cases, compared with roughly 12 MiB in the earlier standalone Node fixture. Both are included in their respective totals. The extra process is part of the cost of reliable model ownership; this report does not hide it or claim a Rust replacement exists.

The desktop retains about 367 MiB after the two replies and model setup/stop, versus roughly 290 MiB before setup. Renderer heap, loaded modules, main-process state, graphics allocations and caches remain within the reported desktop totals. This experiment does not establish that the remaining difference is a leak, that all of it is necessary, or that app RAM is fully optimized. Read-only renderer heap/DOM observations are included in the raw report; collection was not requested.

## Behavior checked

All six apps complete both real CPU-model responses through the actual composer and display nonempty reply bodies. The next chat wakes the model automatically. This tests protocol completion and rendering, not whether the small 0.5B model follows every prompt correctly or performs useful coding work.

The **actual composer model picker**, followed by ten public `modelCatalog` bridge calls in every app, preserves the sleeping/ready state. This checks more than the setup dialog's discovery endpoint. Both native `/models` and OpenAI-compatible `/v1/models` map to the same cached metadata handler in the pinned [server route registration](https://github.com/ggml-org/llama.cpp/blob/cd959bae99ff4bed22bef2604f45241c09bbb8c8/tools/server/server.cpp#L174). The targeted [lifecycle and metadata source](https://github.com/ggml-org/llama.cpp/blob/cd959bae99ff4bed22bef2604f45241c09bbb8c8/tools/server/server-context.cpp#L6367) confirms why reading the list need not load native weights. A suspected alias wake-up issue was therefore disproved for this pinned runtime; no unnecessary catalog patch was made.

Stop removes both the actual native server and Electron guardian before the final samples. Every measured app main PID, native PID and guardian PID is absent after the outer runner completes. The previously shipped start/sleep/wake/stop implementation is unchanged in this phase.

## Method and scope

- **Runtime/model:** Electron 44.7.2, its Node 24.21.0 and V8 15.2.124.37-electron.0; llama.cpp b12110 at `cd959bae99ff4bed22bef2604f45241c09bbb8c8`; Qwen 2.5 0.5B Instruct Q4_K_M at `9217f5db79a29953eb74d5343926648285ec7e67`. Existing portable archive and GGUF size/SHA-256 values are verified before running. Nothing is installed or downloaded by the benchmark.
- **Workload:** 4,096 context tokens, two CPU threads, one native slot, 128/64 batch sizes, no native prompt-cache RAM. Each fresh app has a disposable profile/project; installed-agent discovery and automatic update polling are disabled only in the fixture. Six settled boundaries per app, five complete procfs samples per boundary: **180 complete samples**, with zero rejected attempts in the final set. Samples use stable process identities and PSS, rather than summed RSS. One read-only CDP heap/DOM observation follows each boundary.
- **Comparison:** three serial pairs, with the middle pair's order reversed. Sources and the entire measured production UI build are hashed before/after. No tests, builds or other benchmarks overlap these final runs. This is descriptive paired evidence, not a randomized statistical inference or latency/throughput test.
- **Collection:** no forced GC, custom collector or heap flag. Historical V8 articles on [reachability and Orinoco](https://v8.dev/blog/trash-talk) and [parallel compaction/remembered sets](https://v8.dev/blog/orinoco) were read to distinguish collector behavior from application/native ownership. They are historical explanations, not exact specifications of today's measured V8. Their published benchmark percentages are not applied to Tributary.
- **Boundaries:** includes Electron main/renderer/utility/graphics descendant processes, guardian and CPU server. Excludes Xvfb, detached/reparented helpers, page cache and driver allocations outside the tree. No GPU/VRAM, other runtime, installer, native Windows/macOS, model-quality, natural peak/GC-pause or universal speed claim.

An initial single-case probe passed. An earlier paired-set attempt stopped when a short-lived process exited during procfs accounting. That entire exploratory set is excluded from the final comparison. The final harness records incomplete attempts separately, uses no incomplete totals and fails if twenty attempts cannot produce five complete samples at a boundary. Final cases required no retries.

[Raw paired measurements](local-engine-desktop-memory.json) · [Verification](local-engine-desktop-verification.json) · [Reading scope](local-engine-desktop-reading.json) · [Real model chat screenshot](local-engine-desktop-chat.png).

Run on Linux after stopping other tests/builds:

```sh
npm run bench:local-engine-desktop -- /absolute/artifacts.json /absolute/result.json
```

The artifact manifest has the pinned URLs, byte sizes and SHA-256 values in the raw report, plus absolute local `path` values for the already-downloaded files. The runner extracts only into a temporary directory and preserves diagnostics when a case fails. It uses a visible-sized source desktop under Xvfb; it does not open or alter the user's current app/profile.

This closes the earlier **combined Electron + real CPU model** measurement gap. Full historical transcript-body retention, dirty/undo budgets, natural peak/GC latency and broader model/GPU behavior remain open under the original optimization goal.
