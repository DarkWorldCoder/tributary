# Chat and Markdown image working set

`MarkdownImage` previously disconnected its observer after its first intersection and kept `FileContent`, base64 and a data URL in React state/memos. Scrolling through a gallery therefore permanently expanded its derived working set for that mounted reply or Markdown file. This phase extends the workspace image resource boundary to local images in both surfaces.

## Ownership and geometry

Only near, keyboard-focused or explicitly opened image previews own a resource. Other cards retain numeric intrinsic dimensions and an empty, hidden-from-assistive-technology SVG placeholder. Its scaled intrinsic dimensions and automatic height match the existing image box, including portrait, landscape and small images, without keeping encoded content. Initial unseen images retain the original minimum-size box; first-load growth remains possible.

One document-level observer handles repeated entrance and exit. Removing a target removes its callback; the last target disconnects the observer. Registration times and observer generations reject stale queued notifications. Missing/failed observer support keeps content accessible through eager requests; that fallback does not establish viewport memory savings. The shared bridge resource manager still admits at most two reads/decodes and 128 distinct active resource keys. Admission errors are explicit and do not remove source text or gallery cards.

Source/project identity is scoped without duplicating arbitrary source URIs in React keys. Late decode callbacks cannot overwrite a new source. Duplicate default references share the same resource; each explicit Retry uses a fresh window-local attempt ID so another duplicate's failed attempt cannot block recovery. Source changes close the old dialog. Native focus return intentionally pins the source until focus moves away, even when its card is offscreen. A closed pending preview with no remaining visible/focused owner discards its eventual read response.

Remote HTTP(S) references remain explicit external-open buttons. Path validation and the existing file-size/project guards remain in place. No dependency, production forced GC, artificial heap ceiling or Rust bridge is added. Returning to a released image requires another read and decode; memory release is not a promise of faster revisits.

## Measurements

[The frozen raw matrix](gallery-memory.json) contains eighteen fresh Linux source Electron instances, three alternating pairs per scenario, with **96 complete process-tree observations**. Both versions use identical files and dependencies. Source, compiled JS and harness hashes are recorded; no tests/builds overlap these final runs. The first matrix and failed fixture runs are exploratory and are excluded from these final values.

The sixteen-image gallery retains **71,366,016 → 0 base64 characters** in React state after visiting every image. The optimized gallery keeps three live Blob URLs at the recorded scroll positions and preserves all sixteen cards. Observed full-read concurrency is ten before and two after in the unforced cohort.

Unforced app-tree PSS medians in MiB:

| Checkpoint | Before | After |
| --- | ---: | ---: |
| Initial gallery | 579.07 | 453.45 |
| Walked forward | 809.35 | 692.81 |
| Returned to start | 777.65 | 814.64 |
| Returned to bottom | 777.67 | 748.67 |

The **returned-start checkpoint is worse**, so this is not a universal app-RAM reduction. Final PSS differences within pairs are −28.16, −90.19 and −45.36 MiB. The one-tiny-image control is effectively unchanged at final median 343.35 → 343.06 MiB, with mixed pair differences (−0.65, +9.58 and −12.47 MiB); no small-gallery RAM improvement is established.

In the separate diagnostic cohort, final renderer `usedSize` is **134.47 → 7.54 MiB** and final app-tree PSS is **733.06 → 659.99 MiB**. `usedSize` is a V8 heap counter, not total renderer RAM; external/backing storage is recorded separately in the raw report. Unforced final renderer heap is 154.94 → 62.66 MiB. These checkpoints do not establish continuous peaks, production GC behavior, pause durations or model memory savings.

The unforced scroll-request-to-decoded/reference-checked DOM median is 11.29 → 11.90 ms on the forward walk and **3.00 → 10.45 ms on reverse visits**. Fixed settling waits are excluded, but polling, IPC and canvas verification remain included. Re-reading released images costs time; this phase does not establish a general speedup or input-to-paint improvement.

## Validation

The [native verification](gallery-verification.json) records **19 grouped checks** in a real conversation and Markdown file preview with sixteen deterministic PNGs in square, landscape, portrait and tiny sizes. Forward/reverse visits check reference pixels and dimensions, every card, all known tile positions/sizes and total scroll height. Additional checks cover narrow/wide windows, native Tab, modal/focus ownership, duplicate references, source changes, missing-file retry, independently failed duplicate retries, discarded late reads, explicit remote references, local SVG, hidden file previews and missing observer support. Native screenshots were visually inspected; hashes are recorded. Snapshot/geometry verification is separate from physical input-to-paint certification.

All **670 local regressions pass**, including twelve focused image-resource/visibility tests. TypeScript and production UI/extension builds pass. The [complete static-closure audit](gallery-bundles.json) adds 5,070 minified JS bytes to cold chat and 1,896 bytes to the workspace closure; gzip totals are recorded. The resource module moves partly into cold chat because local chat images now share it. Editor, settings and team-dialog code stay lazy. Benchmark sources and raw evidence remain outside the installer file allowlist.

An exploratory empty-SVG placeholder matched only 3/15 primitive layouts and was rejected. Scaling intrinsic dimensions to the existing height limit and using automatic CSS height matched all 15 primitive cases; the actual application checks additionally verify tile positions and scroll height. Early fixture mistakes focused a hidden composer or blurred a dialog trigger before its delayed focus return. Those failed attempts do not contribute performance medians. The independently failed duplicate Retry was reproduced in the candidate implementation and fixed before final measurement.

## Reproduction

Build the baseline source `92aba8e802a33232728b9555e7206bd8b4086c69` with the same dependencies, then build the current UI:

```sh
node scripts/performance/gallery-images.cjs /absolute/built/baseline /tmp/gallery-verification.json verify
node scripts/performance/gallery-images.cjs /absolute/built/baseline /tmp/gallery-memory.json
node scripts/performance/gallery-bundles.mjs /tmp/gallery-bundles.json
```

Requires Linux procfs, Xvfb, native Electron and `/usr/bin/python3` with Pillow. Private profiles live inside the driver's scratch tree and are removed after the child exits. Source, built-JavaScript and harness fingerprints are checked before/after runs. The memory matrix uses three fresh alternating pairs for one tiny image without forced GC, sixteen images without forced GC, and sixteen images in a separate diagnostic-collection cohort. No tests/builds overlap final memory runs. Incomplete process-tree observations remain marked incomplete; only complete paired totals support memory claims. Sampling checkpoints are not continuous peaks or GC pause measurements.

## Reading scope and remaining work

Read the substantive text/listings of the author-hosted [Rust `Rc<T>` chapter](https://doc.rust-lang.org/book/ch15-04-rc.html), including its shared-data and reference-count examples. Read the relevant [Intersection Observer overview, options and callback ordering](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API). [Reading provenance](gallery-reading.json) distinguishes these scopes from the entire book/API documentation. Rust code was not compiled and JavaScript cleanup is not compiler-enforced Rust ownership.

Whole-app native/browser-owned memory can grow as images are revisited even when JS live data and Blob bindings are released. Attribution to decoder caches, detached elements, allocator retention or other native owners needs further evidence. Print-specific image preparation, dense/fallback galleries beyond admission limits, longer lifetime cycles, primary dirty/undo budgets, other OS/device/model cases and exhaustive book coverage remain under the active original optimization objective.
