# Rejected encoded gallery prototype

Releasing the last Blob URL removed encoded image data from React ownership, but it did not bound Chromium's decoded-image caches during repeated gallery visits. The preceding investigation found that removed image elements could be collected while unlocked compositor cache allocations remained. This phase reduces the decoded working set at its source: the card rendition is separate from the original image.

**Not shipped.** This prototype reduced the four-cycle working set, but the twenty-cycle check reached approximately the same app-memory range: final settled PSS was 1,002.48 → 1,024.62 MiB in one unforced pair. It delayed native cache growth and added conversion cost. It is not the final implementation. The [long-run record](encoded-rendition-long.json) and [source patch against 25c7173](encoded-rendition-prototype.patch.gz) preserve that counterevidence and make the experiment reproducible.

## Resource contract

Only local chat and Markdown cards use the gallery rendition. The full image viewer and editor image previews continue to read the original bytes. Expanding a card acquires a separate original lease; closing it releases that lease while a visible or focused card retains its rendition. Both kinds share the existing two-slot read/decode admission and duplicate-reference ownership rules. No file is rewritten or cached on disk.

Eligible static JPEG and 8-bit PNG images are resized without upscaling. The card is capped at 256 CSS pixels high; rendition bounds retain at least 2x pixel density and follow denser displays up to the documented 4x limit. The ordinary 1x test display uses a 2,048 × 512 rendition box. JPEG card renditions use quality 0.9; PNG card renditions remain PNG. Original dimensions determine card layout and unloaded placeholders, rather than rounded thumbnail dimensions. Already-small PNG headers avoid unnecessary bitmap work.

APNG, GIF, WebP, AVIF, SVG, BMP, ICO, unknown/malformed containers, 16-bit PNG and PNG HDR metadata bypass flattening. Missing APIs, decode/canvas failures and unsupported encoders retain the original browser image path. The PNG predicate is not a new image validator or a replacement for the browser decoder. It conservatively selects which containers may be flattened; existing project-path and source-size checks remain in place.

Original and resized `ImageBitmap` handles close in `finally`, including cancellation during decode, resize or encode. Temporary canvas storage is reset after encoding settles. Source reads remain full-file bridge reads and are still bounded by shared admission. This is derived working-set control, not a new process-wide memory limit or a replacement garbage collector.

## Measured comparison

[The frozen matrix](encoded-rendition-memory.json) contains **18 fresh apps and 216 complete process-tree observations**. Both modes use identical image bytes/dependencies. Ordinary memory/timing and explicit diagnostic collection use separate app cohorts. Values below are medians of three alternating pairs.

Ordinary app-tree PSS, MiB:

| Checkpoint | Before | After |
| --- | ---: | ---: |
| Initial | 447.71 | 430.01 |
| First forward walk | 617.02 | 554.23 |
| First return to start | 689.44 | 569.64 |
| Bottom revisit | 699.99 | 482.82 |
| Second forward/reverse cycle | 891.33 | 653.55 |
| Third forward/reverse cycle | 989.77 | 690.07 |
| Fourth forward/reverse cycle | 1031.75 | 708.17 |
| Reply cleared | 1032.74 | 708.95 |
| Cleared and settled | 1023.68 | 710.13 |

Final paired PSS differences are -315.91, -315.19, -313.55 MiB. Early individual pairs include increases (including +50.33 MiB after a first forward walk), so this is not an improvement at every checkpoint or a sampled-peak guarantee.

The one-tiny-image control ends at 318.62 → 317.66 MiB, with final paired differences -0.90, -0.92, -0.96 MiB. It does not establish a substantial idle/small-gallery RAM saving. The small-image native-API fast path was checked separately; an earlier pre-adjustment matrix is exploratory and excluded from these values.

In the separate diagnostic cohort, final app-tree PSS is 808.54 → 539.12 MiB while renderer V8 live heap remains 7.49 → 7.55 MiB. This reinforces the distinction between live JS objects and opaque/native working sets; it does not exactly attribute every PSS byte. Natural heaps and external/backing storage remain in the raw report.

Ordinary scroll-request-to-decoded-DOM medians include IPC, polling and geometry checks, but exclude fixed settling waits. They are not physical input-to-paint times. Forward visits are 12.49 → 29.01 ms, reverse visits 7.33 → 22.49 ms, and fourth-cycle visits 7.85 → 19.07 ms. Resizing costs CPU/time; this phase does not establish a general speedup. Memory still grows across repeated cycles, so smaller decoded images do not certify a globally bounded browser cache.

## Fidelity and scope

All **677 local regressions** pass, including nineteen focused ownership/rendition/visibility tests, with TypeScript and the production UI build. [Native verification](encoded-rendition-verification.json) records **37 grouped checks** across chat, Markdown-file preview, missing observer and missing bitmap APIs. It verifies card dimensions against original aspect/layout constraints, forward/reverse geometry, exact original PNG pixels/dimensions, actual-size zoom, focus return, independent resource release, duplicates, source changes, retry, late responses, remote-reference behavior and local SVG. APNG/GIF/WebP animation is checked through painted native captures and exact source hashes. A canvas `drawImage` probe alone would inspect a default animation frame and cannot certify playback. EXIF-oriented JPEG, alpha PNG and 16-bit PNG originals retain their exact bytes.

The complete static-closure [bundle audit](encoded-rendition-bundles.json) adds 2,390 minified JavaScript bytes to both measured cold-chat/workspace closures, with gzip differences recorded. Editor, settings and team-dialog chunks remain lazy. These bytes are not startup-time or memory measurements. Reports and performance fixtures remain outside installer file inclusion.

Early candidate geometry was wrong when original HTML width/height attributes independently clamped a thumbnail box. Original-aspect CSS sizing corrected it. Fixture corrections separately addressed first-frame-only canvas animation checks, CSP-blocked diagnostic Blob fetches, shared files leaking between cases, a legitimate remaining duplicate owner, and reading an original before decode completed. Those failed/exploratory attempts are excluded from final comparison values. Security policy and original-pixel assertions were preserved.

The measured workload is sixteen deterministic static RGB PNGs in square, landscape, portrait and tiny sizes, plus a separate one-tiny-image control, in Linux source Electron with Xvfb. Other image formats have functional coverage as described, not equivalent memory/latency cohorts. No hardware-GPU, installed Windows/macOS, print workflow, image-attachment pipeline, exhaustive color-space or all-device certification is implied. Animated/high-precision paths still retain their original decode costs. Further source streaming, dirty/undo working sets, remaining native owners, production GC pause attribution and model RAM/VRAM remain under the original active objective.

## Reproduction and reading

Build baseline `25c71737476a42c0f8ee996b1ea007e7efd869cb` with the same dependencies, apply the archived source patch, then build the candidate UI:

```sh
node scripts/performance/rendition-images.cjs /absolute/built/baseline /tmp/rendition-verification.json verify
node scripts/performance/rendition-images.cjs /absolute/built/baseline /tmp/rendition-memory.json
node scripts/performance/rendition-bundles.mjs /tmp/rendition-bundles.json
```

Set `TRIBUTARY_BENCH_CASE_LIMIT=1` to execute one fresh case per invocation and append `--resume` when continuing its report. Verify mode retains `verify` before `--resume`. A partial report is not a completed cohort.

Memory cases exclude canvas pixel/hash checks and full-view validation; those run in a separate functional cohort. Three alternating fresh app pairs per memory scenario cover one small image without forced GC, a sixteen-image gallery without forced GC, and a separate diagnostic-collection gallery cohort. Each gallery executes four forward/reverse cycles, a bottom revisit and clearing/settling checkpoints. Scripted scrolling first signals scroll intent so chat auto-follow cannot race the test. Source, compiled-JavaScript, harness and generated-image fingerprints must remain unchanged. Each completed case is checkpointed atomically; bounded invocations resume only after those identities match. Reports explicitly mark whether every planned case completed. An earlier interrupted matrix is excluded. Profiles are removed after child exit; cases reset generated/repaired files. No tests/builds overlap final memory runs. Process-tree completeness, sampled-versus-peak scope and external allocations are recorded in raw data.

[Reading provenance](encoded-rendition-reading.json) covers scoped MDN bitmap/canvas API sections, PNG animation/HDR chunk rules, HTML's animation/default-frame rule and the previous pinned Chromium cache investigation. It does not claim entire books/specifications were read, or that a JavaScript heap decrease certifies total app-memory improvement. No new dependency, Rust bridge, forced production GC, memory-pressure API or arbitrary global heap ceiling is introduced.

Archived source patches use deterministic gzip compression. Decompress with `gzip -dc path/to/prototype.patch.gz | git apply -` inside the clean baseline checkout before building that historical candidate. Both archives passed a clean-baseline apply check after decompression.
