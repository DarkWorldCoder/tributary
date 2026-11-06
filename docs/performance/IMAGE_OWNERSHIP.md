# Workspace image ownership

The workspace previously kept each opened raster's base64 payload in its `Doc` record. React state and alternate trees could retain those strings after the user selected another tab. Opening more tabs also restarted the file watch, rereading all watched raster bodies. Image restoration admitted payload reads for all saved tabs at once.

The workspace now loads raster metadata for tab state and file watching. Only visible raster previews own payload resources. Consumers of the same project/path/revision share one Blob URL; the last consumer releases it. A hidden Files surface releases its raster previews while preserving the tabs. SVG text remains normal primary editor state and its derived URL is effect-owned. Dirty source, recovery snapshots and undo state keep their existing ownership.

## Admission and cleanup

- A bridge owns a private resource manager through a WeakMap. At most two raster reads/decodes are active and at most 128 distinct visible resource keys are admitted. This is a bound on admitted work/metadata, not a bound on arbitrary decoded pixel memory.
- Closing a queued consumer removes its work. Closing during a file RPC discards the response; that RPC is not physically aborted. Closing during cooperative fallback decoding discards further work. A URL returned after disposal is immediately revoked.
- Revision identity includes file timestamp, actual watch notifications and explicit reload/retry. Same-size writes that restore the timestamp still refresh. Shared groups release only their own subscription/lease.
- Native `Uint8Array.fromBase64` is used when available. The fallback decodes in 64 KiB encoded chunks and periodically yields. A full base64 RPC response and decoded byte array still coexist temporarily. This is not zero-copy image transport.
- Existing project, symlink, regular-file and size guards remain in `Hub.readFile`. Metadata-only mode skips the body only for recognized rasters; text reads still return actual text.

## Research and limits

Read the captured text and listings of [The Rust Programming Language, References and Borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html). Its ownership/lifetime discussion informs the explicit owner/consumer boundary. No Rust examples were compiled, other book chapters or linked references were not covered in this pass, and JavaScript leases do not inherit Rust's compiler guarantees. Read the API description, syntax, parameters, return value and lifecycle notes of [MDN's `URL.revokeObjectURL`](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static); its cleanup contract is implemented at the last consumer. The linked File API specification was not read in this pass.

This phase covers workspace image tabs. Markdown/chat attachments still have a separate payload lifetime; moving those to viewport-owned resources requires stable placeholder geometry to preserve scroll. Browser image caches, very large decoded dimensions, external model memory, GPU-driver allocations and full app GC pauses are not solved here. No production forced GC, new dependency or Rust bridge is added. The original memory optimization objective remains active.

## Measured working set

The [frozen raw matrix](image-memory.json) contains twelve fresh Linux Electron 44.7.2 source apps: three alternating pairs without forced collection, and three separate pairs with diagnostic renderer GC at checkpoints. All **54 process-tree observations are complete**. The image data and dependency installation are identical; source/compiled-JavaScript and harness hashes are recorded. Native `Uint8Array.fromBase64` is available in all instances; the optimized implementation calls it and the baseline uses its existing data-URL path.

Medians in MiB, with six 1536 × 1536 PNGs pinned and only one visible:

| Cohort / metric | Before | After |
| --- | ---: | ---: |
| Unforced renderer heap | 489.64 | 82.75 |
| Unforced app-tree PSS | 1,071.44 | 649.43 |
| Diagnostic retained renderer heap | 184.96 | 13.36 |
| Diagnostic retained app-tree PSS | 756.34 | 506.55 |

The unforced app-tree differences within pairs are −380.10, −426.54 and −470.39 MiB; diagnostic differences are −243.47, −269.68 and −215.29 MiB. Primary tab records retain **56,654,064 → 0 base64 characters**, with all seven tabs preserved. Each optimized instance performs six full image reads across the entire workload; the baseline performs 61–65. Observed maximum concurrent body reads are six before / one after in this sequential workload; the manager's two-read admission limit is separately pressure-tested.

After closing five images, unforced median renderer heap / app PSS are 466.68 / 1,091.55 MiB before and 77.58 / 663.02 MiB after. Those are ordinary checkpoint observations with whatever garbage the engines have collected; they do not establish a leak after closing. In the separate diagnostic cohort, the same final checkpoint is 58.20 / 610.74 → 13.22 / 498.40 MiB. Initial unforced app PSS is essentially unchanged (364.89 → 365.26 MiB); this phase does not establish idle-app RAM savings. Sampled checkpoints are not continuous peaks, GC pauses, total GPU memory or universal app/model results.

## Functional and visual verification

[The native report](image-verification.json) records eight grouped checks: exact PNG pixels/dimensions and preserved tabs; shared split/dialog ownership; real same-size/restored-mtime writes; hidden-view release/return; corrupt image error/retry/recovery; JPEG/GIF/WebP/BMP/ICO/AVIF/SVG decoding and primary SVG text; oversized-file metadata fallback; and real renderer reload restoring every tab while loading only the active raster. GIF decoding is checked, not animation scheduling. SVG undo/redo is checked while its source editor remains mounted; history across source/preview or tab unmount is not certified by this check and remains part of primary editor ownership work.

An optional [verification hook](../../scripts/performance/image-geometry-hook.cjs) waits for the settled frame and captures a screenshot separately from memory measurement. The visible image is **685 × 685 CSS pixels** within a **1,055 × 717** viewport at 45% fit, with visible/block styles. The screenshot was visually inspected; its hash and the hook hash are recorded. This guards against accepting decoded but zero-sized images; it does not measure input-to-paint latency.

## Reproduction

Build the baseline commit `7791c85820898dcbeef97a29f8d838bfbe0b2527` in a separate temporary source tree using the same dependency installation, then build the current UI. Run:

```sh
node scripts/performance/image-ownership.cjs /absolute/built/baseline /tmp/image-memory.json
node scripts/performance/image-ownership.cjs /absolute/built/baseline /tmp/image-verification.json verify
```

Requires Linux procfs, Xvfb, native Electron dependencies and `/usr/bin/python3` with Pillow. Both source apps run with fresh private profiles and no agents. Six deterministic 1536 × 1536 RGB PNGs are pinned alongside one source file; each image must actually decode and match a reference pixel. Three fresh alternating pairs per cohort separate unforced observations from explicit diagnostic retained-memory observations. No builds/tests run concurrently with final measurement. Source and compiled-JavaScript fingerprints are checked before/after every instance. The sampler retains incomplete process-tree observations as incomplete; only complete PSS totals support numerical claims. Poll/checkpoint observations are not continuous peaks or physical input-to-paint timing.

For AVIF verification, set `TRIBUTARY_IMAGE_PYTHON` to a Python/Pillow installation with AVIF encoding (the recorded run uses Pillow 13). The geometry check additionally sets `NODE_OPTIONS='--require /absolute/repo/scripts/performance/image-geometry-hook.cjs'` for this isolated invocation only. The optional hook never participates in memory pairs or production startup.

The exploratory prototype, preliminary matrix and failed fixture attempts are excluded from final paired results. Fixture corrections covered Radix tab activation, overflowing tab controls, synthetic redo shortcut translation and enabling the CDP Page domain before reload instrumentation. The final harness uses focus/native Enter for tabs, DOM control activation for buttons and native input for editor typing/undo. It asserts that tabs actually close. These are source-app functional checks, not certification of every physical input path or layout.

## Regression and bundle checks

All **666 local tests pass**, including metadata-only boundary tests and eight resource lifecycle/decoder tests. TypeScript and clean production UI/extension builds pass. [The bundle audit](image-bundles.json) compares complete static closures with identical dependencies: cold chat adds 288 minified JavaScript bytes and the workspace closure adds 4,163 bytes. Gzip totals are recorded in the artifact. Code editor, settings and team dialogs remain outside cold chat's static import closure. This audit is not a startup-time or app RAM measurement.
