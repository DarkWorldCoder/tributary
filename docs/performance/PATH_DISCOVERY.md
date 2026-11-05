# Bounded filename discovery

Measured 5 November 2026. This changes the producer used by project filename indexes and file mentions; it does not establish lower total application RAM or local-model memory.

## Change and completion contract

Previously, `core/git.js` requested `git ls-files --cached --others --exclude-standard -z` through `host.exec`, allowing **200,000,000 bytes per output stream**, then split and deduplicated the entire output before slicing to the requested count. A short returned prefix could retain the larger decoded string behind its filenames.

`path-command.js` now consumes raw stdout chunks and `path-prefix.js` retains only the first requested number of distinct nonempty names. It decodes selected NUL-delimited records, handles UTF-8 characters across transport boundaries, and grows one partial-record buffer geometrically instead of retaining an object for every fragment. After the prefix fills, output is still drained and counted, without decoding/storing the unused names. The Set and partial buffer are explicitly released on completion or disposal.

Success requires the child's **close** event and zero exit status. Reaching the prefix limit is not completion. A late Git error discards the partial Git result and uses the existing directory fallback. Timeouts, pipe errors and byte-limit failures settle once, remove the parser's listeners, drain remaining pipes and invoke the host's existing process-tree cleanup. The independent stdout/stderr byte ceilings and eight-second Git timeout remain. [Node's child-process contract](https://nodejs.org/api/child_process.html#event-close) distinguishes pipe closure from process exit and warns that unconsumed pipes can block the producer.

Both local and SSH hosts use the streaming path. The remote non-Git `find` fallback uses NUL delimiters, so newline-containing filenames remain intact; it retains completed best-effort records on failure as the earlier fallback did. Custom exec-only hosts still own their complete output buffer; their compatibility parser scans only the prefix and copies selected names so they do not retain that parent string. The local non-Git fallback now respects the file limit inside each directory loop, fixing an overrun, but still uses bulk `readdirSync` and preserves its traversal ordering.

## Paired measurement

[Final raw report](path-discovery-benchmark.json), [earlier run](path-discovery-exploratory.json), [runner](../../scripts/performance/path-discovery.cjs).

The baseline is frozen `84b1f64:core/git.js`; unchanged host/process helpers are shared. Each mode runs in a fresh Node 24.21.0 process. Three pairs alternate their order for each workload. Fixtures are actual Git indexes containing generated tracked paths absent from the worktree; Git traversal/output is real, not a replayed stream. Construction is outside the measured process tree. Both modes launch one command, consume identical byte counts and return an identical checksum/order. No other agent-run benchmark or test suite ran during the pairs.

| Median, three runs per mode | Buffered | Streaming |
| --- | ---: | ---: |
| 1,000 paths / 158,000 bytes: elapsed | 8.86 ms | 12.68 ms |
| 1,000 paths: retained total JS heap | 5.16 MiB | 5.21 MiB |
| 400,000 paths / 63,200,000 bytes: elapsed | 726.78 ms | 235.12 ms |
| Large index: process CPU | 697.86 ms | 225.71 ms |
| Large index: JS heap at successful return | 178.24 MiB | 10.46 MiB |
| Large index: retained total JS heap | 66.10 MiB | 8.64 MiB |
| Large index: retained heap increase over settled baseline | 61.27 MiB | 3.77 MiB |
| Large index: Node process RSS high-water at return | 293.93 MiB | 93.67 MiB |
| Large index: natural GC event durations during the operation | 90.52 ms | 8.87 ms |

The large workload requests **20,000** names and retains those same names through diagnostic collection. Streaming still drains all 63.2 million output bytes. It reduces unused materialization and allocation; it does not stop Git early or reduce network transfer. The under-limit workload shows a small slowdown and slightly higher retained heap, so a universal speedup is not established. Run ranges, actual CPU and all GC events remain in the JSON.

Diagnostic GC occurs only before/after timed work, never in production. Timed GC event durations are not an exact measure of stop-the-world pauses or UI latency. RSS high-water includes process startup; in the small workload it exceeds the sampled return RSS and is not an operation-only allocation counter. The runner also samples the Node/Git process tree every 25 ms: median observed peak PSS is 260.25 → 177.17 MiB for the large case, but short-lived children and non-atomic reads make this an observed peak, not a guaranteed true maximum. Incomplete samples remain recorded and are excluded from aggregation. Parent fixture construction, external model processes, Electron renderer RAM, physical cold-cache behavior and native Windows/macOS performance are outside this experiment. These numbers must not be added to previous Explorer/UI workloads.

## Correctness and packaging

The path tests cover every byte-fragment boundary in UTF-8 names, spaces/newlines/quotes, duplicate order, actual unmerged Git index stages, hidden/ignored names, record/output bounds, zero/invalid limits, failed/late process status, timeouts, pipe/spawn errors, disposal and local fallback limits. The offline SSH adapter tests exercise actual process transport, NUL-based fallback and remote timeout/PID cleanup. They do not certify a live remote network or Windows SSH installation.

[Actual desktop checks](path-discovery-desktop.json) preserve exact dirty text, outline expansion/scroll and search-filter state across six 20,000-path projects. Late index/outline replies remain harmless and hidden searches stay cancelled. This is a correctness run; its memory samples are deliberately excluded from the performance comparison.

[ASAR smoke](path-discovery-asar.json) loads all streamed Git dependencies from a synthetic archive in the actual Electron runtime and checks real Git results. The distribution verifier now requires both new core modules. This is not a complete new installer build or native platform release.

Final validation: **569 full regression tests passed**, eight direct path tests plus the offline remote coverage included. TypeScript, production UI build and VS Code bundle build pass. [Verification manifest](path-discovery-verification.json) records source fingerprints and the validation boundaries.

Reproduce after dependencies/UI are built:

```sh
npm run bench:path-discovery -- /absolute/report.json
node --test test/path-prefix.test.js test/remote.test.js
node test/e2e/path-discovery-asar.cjs /absolute/asar-report.json
TRIBUTARY_DERIVED_MODE=released TRIBUTARY_DERIVED_OUTPUT=/absolute/desktop-report.json node_modules/.bin/electron scripts/performance/native-explorer-derived.cjs --no-sandbox --ozone-platform=x11
```

## Reading and remaining work

[OSTEP chapter 39, Files and Directories](https://pages.cs.wisc.edu/~remzi/OSTEP/file-intro.pdf) was read as the complete author-hosted chapter text/listings, including references and homework prompts; the directory-tree and shared-open-file diagrams were visually inspected. Its distinction between a name, an open handle and underlying shared state reinforces explicit resource lifetime and incremental consumption. This is one chapter, not the whole book; examples/homework were not executed. Exact reading hashes/scope are in the [research inventory](../MEMORY_OPTIMIZATION_RESEARCH.md).

Remaining work includes local non-Git directory allocation, active-tree/transcript virtualization, dirty/undo document working-set control, other main-process retainers and peak allocations, real model RAM/VRAM scheduling, live remote performance and packaged/cross-platform measurements. No Rust bridge, runtime collector replacement, production forced GC or arbitrary heap-limit change was introduced.
