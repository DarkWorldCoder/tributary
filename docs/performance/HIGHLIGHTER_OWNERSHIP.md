# Cancelled highlighter owners and small-reply controls

## Small-reply process memory

The previous code-viewport report retained an unexpected approximately 10 MiB increase in small-case process-tree PSS. That figure was the difference of separate three-process medians. Its individual pair differences were approximately +1.07, +9.81 and +0.10 MiB. It was not a demonstrated ten-megabyte allocation by the new renderer.

The [follow-up controls](code-small-controls.json) use three same-build A/A pairs interleaved with three direct parent/current pairs, reversing side order for the middle repetition. Every process receives the same three 20-line TypeScript replies and five post-diagnostic-renderer-GC samples. The current build for this investigation is **ff26dfc**, before the highlighter fix below. The parent restores the actual pre-viewport `867f49a` Markdown/editor/title-bar sources and desktop, with the same current core and dependencies; it includes the search-label change that the older `c40ea95` baseline predates. The hook was identical at both revisions. Both A/A sides use the same UI hash. No other tests or benchmarks ran during these controls.

| Metric: current minus reference | Same-build A/A paired differences | Parent/current paired differences |
| --- | --- | --- |
| Process-tree PSS | −9.10, +4.58, +20.49 MiB | +0.268, +0.239, +0.393 MiB |
| Process-tree private pages | −2.98, +0.34, +3.22 MiB | −0.914, −0.285, +0.563 MiB |
| Renderer JS heap | −2.06, −2.53, +11.59 KiB | +9.00, +21.85, −1.41 KiB |
| DOM nodes | 0, 0, 0 | +5, +5, +5 |

Median paired PSS differences are +4.58 MiB for the A/A controls and +0.268 MiB for parent/current. Difference-of-medians values are retained separately in the raw report: +7.92 and +0.393 MiB respectively. Identical builds alone show larger variation than the direct comparison in this experiment. This weakens attribution of the earlier ten-megabyte aggregate difference to the viewport change; it does **not** prove equivalence, absence of a regression, or a universal small-case RAM improvement. Three pairs cannot establish such a conclusion. Shared-page attribution and other OS/display activity are not held constant by fresh profiles or diagnostic renderer GC.

The new runner reports signed within-pair deltas, independent medians, full process-tree samples and source/UI fingerprints. It rejects incomplete accounting. These are settled memory observations, not peak limits or natural-GC/latency measurements. The prior report and its raw runs remain unchanged apart from a link to this follow-up.

### Statistical reading

The full retrieved text of NIST/SEMATECH e-Handbook sections [7.3.1.1, Analysis of paired observations](https://www.itl.nist.gov/div898/handbook/prc/section3/prc311.htm), and [5.3.3.2, Randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm), was read, including equations, the blocking example/design table and model estimates. Linked chapters and the whole handbook were not read; its t-test examples were not executed. The applied principle is to examine differences within a nearby pair and expose nuisance variation with controls. Alternating order here is deterministic, not a fully randomized block design. No t-test, p-value, confidence interval or claim of statistical significance is made.

## A separate, demonstrated retained owner

While following cancellation paths, the small-code hook showed a cancellation flag around `setLoaded`. The flag prevented a late update, but a pending grammar promise still held the callback and React dispatch. A real disposable Electron app confirmed the path by pausing its actual TypeScript grammar-file request, then expanding a 500-line block past the viewport threshold and unmounting the small renderer.

After extra React commits and diagnostic collections, the old block's Fiber remained reachable. The [captured heap path](highlighter-owner-retainer-path.txt) runs from the module loader's script-promise resolver, through promise reactions/async generators and the hook callback's context, to a bound React dispatch and the unmounted Fiber. The intentionally stalled import makes the lifetime observable; this is not a claim that ordinary local imports remain stalled indefinitely.

The hook now subscribes through an explicit mutable callback owner. Cleanup clears that owner; successful delivery and failure also clear it. Cancellation before the deferred load starts skips the load. A module-level language-loader factory keeps the retained loader's scope independent of the hook render and its dispatch. Merely nulling the receiver while a loader closure still captures the render scope would leave another route to the component.

The shared grammar import is allowed to finish. Cancellation detaches only the obsolete subscriber. Primary text, tokenization state for mounted blocks and live consumers are preserved. This introduces no production GC, finalizer, new runtime dependency or collector/allocator change.

## Verification

- [Native before/after](highlighter-owner-verification.json): the old Fiber is retained while the import is paused; the new Fiber is collected under the same condition. In both runs, releasing the import highlights another live block, and the current large code text remains exact. The fixture and Electron versions/UI hashes are recorded.
- [Synthetic owner checks](highlighter-owner-synthetic.json): cancelled-before-start, cancelled-pending and completed subscribers release their owner even while cleanups and promises remain rooted. An active pending subscriber correctly retains its owner. Four unit tests additionally cover independent consumers, failures and stale delivery.
- [Code-viewer regression](highlighter-code-regression.json): complete text, read-only/Find/copy, active/hidden streaming, native selection pinning, parked view collection, threshold upgrades, wrapping, narrow layout and ANSI language transition still pass.

All **581** final regressions pass, including the four new subscriber tests. TypeScript, the production UI build and the VS Code bundle build pass. The native comparison's source fingerprints and current built entry were rechecked after verification. The baseline-building tool also [reproduces the frozen ff26dfc entry hash](highlighter-baseline-reproduction.json). Native Windows/macOS and new installers were not exercised.

The baseline heap snapshot SHA-256 is `b3742530c75b88fd9c1e4601628bbb3b9ddfbc16aaed88ab8908904884fec58a`; the after-snapshot SHA-256 is `34ccc80d2dfcc313aed20d9e9cd2bfdfdf47c93a36a450bc610a404cbc356ba6`. The large raw snapshots are not shipped in the repository. Heap/Fiber access, request pausing, WeakRef and collection are diagnostic-only instrumentation tied to the installed UI/runtime versions. No exact retained-byte, whole-app PSS saving, ordinary import-time or model-memory improvement is inferred from reachability.

## Reproduce and remaining work

Build the current UI, then use `node scripts/performance/freeze-code-parent.mjs ff26dfc` to produce the frozen pre-subscription-fix host. Pass that host and an absolute report path to `npm run bench:highlighter-owner -- /absolute/host /absolute/report.json`. `TRIBUTARY_HIGHLIGHT_HEAP_PREFIX` optionally captures before/after heaps outside the repository. The same freezing tool defaults to `867f49a` for `npm run bench:code-small-controls -- /absolute/parent /absolute/report.json`. These commands repeat the method against the current build; recorded historical results retain their own UI hashes and source revisions.

The broader memory objective remains active. This removes one verified subscriber owner and improves interpretation of one workload; it does not finish transcript/ANSI/diff working sets, all async/store references, model RAM/VRAM, natural-GC latency or cross-platform distribution verification.
