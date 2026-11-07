# Binary image bridge investigation

Status: locally validated implementation. Installer availability is tracked in [GitHub Releases](https://github.com/DarkWorldCoder/tributary/releases); this report records source measurements, not installer certification. Forty-two focused file/resource/rendition/visibility checks, TypeScript and a fresh production UI build pass. All four native correctness cases (45 grouped checks), the dependency-closure audit and extension build pass. All 684 regressions, the complete eighteen-app short-run memory comparison and the separate twenty-cycle pair are complete.

The explicit-pixel candidate lowers the long-run gallery working set in one twenty-cycle pair, but shorter fresh unforced runs show higher PSS and substantial renderer heap/backing-storage growth before automatic collection. A successful long run alone is insufficient for release. The complete eighteen-app cohort is preserved in [the intermediate report](OWNED_GALLERY_PIXELS.md), together with its source patch and unfavorable ordinary samples.

The next intervention targets representation churn: desktop image reads currently turn bytes into base64, copy that string through IPC/context isolation, then decode it back into bytes before building a Blob. The opt-in exact-size ArrayBuffer response avoids that conversion on desktop while retaining the existing path checks, per-file bounds and shared admission. Text, metadata-only reads, default callers and JSON-based webview transports retain their existing contract. This is a copied binary response, not a zero-copy transport claim or a reason to disable isolation.

[Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args) uses structured cloning for invoke arguments and exposes a Promise response. [The context-bridge type table](https://www.electronjs.org/docs/latest/api/context-bridge#parameter--error--return-type-support) documents copied supported/cloneable values. Native verification must prove the installed runtime actually returns the expected bytes across the isolated bridge. The image resource still has the existing base64 decoder for transports that require it; only the desktop opts into binary reads. Binary file reads allocate unpooled backing storage. A completed full read returns that exact ArrayBuffer; a file shortened during reading gets a slice of only written bytes. No pooled or unwritten backing tail is exposed. Tests cover small/large exact clones, source/path containment, legacy base64, metadata-only reads with no payload, oversized image metadata, partial EOF and descriptor cleanup on failure. The image resource rejects empty, invalid and oversized binary payloads before creating its Blob.

Source-level allocation reasoning is not evidence of reduced app RAM. Functional/native checks, ordinary repeated-process comparisons and timing must be repeated after any implementation change. Existing results must keep their original source/build fingerprints.

[Build/test record](binary-pixels-checks.json) captures final source fingerprints and the 684-pass suite.

## Native and bundle evidence

[Native verification](binary-pixels-verification.json) runs the real sandboxed, context-isolated desktop bridge in Electron 44.7.2. Each case verifies an exact ArrayBuffer length, source SHA-256 and absent base64 response across that bridge. Further checks preserve original full-size image pixels/dimensions, animation/container bytes, JPEG orientation, alpha, duplicate surface ownership, last-owner close, source changes, focus, missing-observer and missing-bitmap fallbacks, retry and late-result disposal. Binary file bodies do not enter the React resource snapshots. Native hashes and pixel reads belong to this functional cohort, never the memory cohort.

The [bundle comparison](binary-pixels-bundles.json) includes both explicit-pixel cards and binary payload decoding relative to published-source baseline `25c7173`: +3,736 minified JavaScript bytes and +1,273 gzip bytes in each cold-chat/workspace closure. Editor, settings and team dialogs stay lazy. These are dependency-closure bytes, not RAM/startup measurements. Benchmark reports, archived candidate patches and test fixtures are excluded from installer files.

The intermediate's long and short results remain at their original fingerprints. New memory results must compare this actual binary implementation using fresh profiles and unchanged images/dependencies. A lower base64 count alone is insufficient to claim lower resident memory.

## Complete four-cycle memory comparison

[The frozen eighteen-app cohort](binary-pixels-memory.json) includes three alternating fresh pairs for each of: one tiny image without forced collection, sixteen images without forced collection, and sixteen images with explicit diagnostic renderer collection. It has **216 complete process-tree observations**. Both sides use the same dependency versions and deterministic image bytes. Every card keeps its original layout geometry, and source/build/harness identities remain unchanged. After gallery removal, no image tiles, canvases, React file payloads or live Blob URLs remain. The diagnostic bitmap tracker is not enabled during these memory runs.

Ordinary gallery app-tree proportional resident memory, median of three runs, MiB:

| Checkpoint | Before | Binary + explicit pixels |
| --- | ---: | ---: |
| Initial | 468.05 | 416.96 |
| First forward walk | 612.49 | 511.25 |
| First return to start | 830.65 | 525.23 |
| Bottom revisit | 837.79 | 457.82 |
| Second forward/reverse cycle | 1070.42 | 519.00 |
| Third cycle | 945.66 | 544.97 |
| Fourth cycle | 979.34 | 462.17 |
| Gallery removed | 981.17 | 440.81 |
| Removed and settled | 977.70 | 441.34 |

Final paired differences are −496.04, −551.02 and −610.12 MiB. The difference between final medians is 536.36 MiB (54.9%) in this workload, not the whole app's idle RAM or a continuous peak. Renderer used heap at the same checkpoint is 80.29 → 12.46 MiB. Every ordinary gallery pair has lower candidate PSS at every sampled checkpoint in this cohort; longer-lifetime and other-workload behavior remain separate requirements.

The tiny-image control ends at 329.19 → 330.55 MiB, with paired differences +1.54, +2.02 and −3.25 MiB. This does not establish a small-image/idle RAM saving. In the separate diagnostic cohort, final retained app-tree PSS is 827.57 → 339.30 MiB, while renderer used heap is 7.51 → 7.59 MiB. Diagnostic collection is a measurement boundary, not product behavior; these values do not replace the ordinary cohort.

Scroll-request-to-decoded-DOM timings include automation, IPC and polling, exclude fixed settling waits and do not measure physical input-to-paint. The median of each run's median visit time is 2.17 → 3.03 ms forward, 3.15 → 4.17 ms reverse, and 1.87 → 2.59 ms in the fourth cycle. The lower working set is accompanied by slightly slower observed decoded-DOM visits; the fixture does not attribute that interval to individual functions. These measurements do **not** prove a general speedup. Natural GC scheduling, allocator capacity and browser caches are still runtime-owned. There is no forced production GC, arbitrary global heap cap or automatic model unload in this change.

The native environment is source Electron 44.7.2 / Chromium 152 on Linux/Xvfb. This is not installed Windows/macOS, hardware-GPU/VRAM, all-format memory, attachment, full-viewer-cache or real inference evidence. No test/build/native benchmark from this task overlapped the final memory cohort. Unrelated OS activity and hardware scheduling were not isolated.

## Twenty-cycle lifetime check

[The longer pair](binary-pixels-long.json) uses two additional fresh apps, identical dependencies/images and 641 decoded-card visits per side. Twenty forward/reverse cycles, a bottom revisit, removal and settling produce **50 complete process-tree observations**, with no forced collection. The fixture performs no full-image dialog or pixel/hash reads during memory measurement. Production source/build fingerprints match the measured candidate. The exact measured native harness is preserved below.

| App-tree PSS, MiB | Before | Binary + explicit pixels |
| --- | ---: | ---: |
| Initial checkpoint | 477.63 | 421.02 |
| After four cycles | 953.15 | 472.68 |
| After twenty cycles | 955.20 | 472.38 |
| Removed and settled | 947.93 | 442.48 |

The final checkpoint is 505.45 MiB lower (53.3%) in this pair; final renderer used heap is 72.72 → 9.73 MiB. Both galleries have no remaining tiles, canvases, sampled file bodies or live Blob URLs after removal. This additional pair supports persistence through this workload, not a universal memory plateau, continuous peak, input-to-paint speedup or all-format/other-OS certification. The previous encoded-thumbnail design's long-run failure and the explicit-pixel/base64 design's unfavorable short-run samples remain archived rather than being replaced by these successful results.

## Reproduction

Build clean baseline commit `25c71737476a42c0f8ee996b1ea007e7efd869cb` and this implementation with identical dependencies. Keep both builds frozen, and run these separately from tests/builds or other native performance probes:

```sh
node scripts/performance/rendition-images.cjs /absolute/baseline /tmp/binary-memory.json
node scripts/performance/rendition-images.cjs /absolute/baseline /tmp/binary-verification.json verify
node scripts/performance/rendition-long.cjs /absolute/baseline /tmp/binary-long.json baseline
node scripts/performance/rendition-long.cjs /absolute/baseline /tmp/binary-long.json optimized
node scripts/performance/rendition-bundles.mjs /tmp/binary-bundles.json
```

After all measurements, four trailing spaces were removed from one empty native-harness line. Parsed JavaScript ASTs were checked identical after excluding source positions, with no production change. [Both hashes](binary-pixels-harness-formatting.json) and the [exact measured harness](binary-pixels-measured-native.cjs.gz) preserve byte-for-byte reproduction. To reproduce the original harness fingerprint, decompress that archive over `scripts/performance/native-rendition-images.cjs` before starting the probes.

Matrix invocations support `TRIBUTARY_BENCH_CASE_LIMIT=2` and `--resume` with unchanged source/build/harness/image fingerprints; incomplete reports never establish a full cohort. Default memory mode completes eighteen fresh apps; native verification completes four separate cases. The longer driver accepts exactly one baseline and one optimized result per report. An observation timeout is not a terminal process result.

## Next ownership boundaries (not implemented here)

- `ui/src/components/chat-attachments.tsx` still has a per-card observer and full base64/`atob` decode. Its image resource is shared with the full dialog, so hiding the card can release an open dialog's URL. A common admission/ownership path must preserve focus and dialog pins before replacing it. Its text dialog reads/decodes the complete attachment before displaying a 256 KiB prefix; a bounded host preview is a separate potential improvement.
- `core/attachments.js` eagerly reads/encodes every resolved attachment. `core/hub.js:sendReserved` then passes image bodies to providers. `core/codex-server.js` consumes local image paths, and the built-in Codex exec arguments in `core/agents.js` also use file paths. Claude, ACP, direct and local-agent image requests consume base64. A future metadata/path-only policy must distinguish these real consumers and verify actual provider input; blindly dropping all attachment bodies would break other integrations.
- This experiment does not evict primary dirty editor/undo state or remove full-image viewer decode-cache costs. Those owners, real model RAM/VRAM and other platforms remain within the original active objective.
