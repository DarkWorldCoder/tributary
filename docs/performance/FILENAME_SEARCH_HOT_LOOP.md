# Filename scanner allocation and responsiveness

This follows the [complete-search ownership change](FILENAME_SEARCH.md). That change fixed missing results and abandoned directory work, but also showed slower complete scans. This pass measures the loop itself before changing its buffer policy or adding another runtime.

## Shipped change

Each directory now owns one continuation rather than allocating a resumption closure for every entry. A name-only query reuses that directory's parent-name match and constructs full paths only for matching files. Queries containing `/` retain full-path substring matching. Directory/query inputs are immutable within a frame, so the derived state is discarded with that frame; a new search reads directories again. Result limits, complete traversal, lexical ordering, hidden/dependency rules and cooperative cancellation remain the same.

Tests compare parent-name, leaf-name and slash-crossing queries with the direct full-path lowercase predicate, including Greek final sigma, dotted Latin I, CJK names, supplementary characters, spaces and hidden files. No filename cache is reused across filesystem changes.

## Equal-output Node comparison

Run `node scripts/performance/filename-tuning.cjs /tmp/filename-tuning.json`. The [raw report](filename-hot-loop-benchmark.json) retains all 72 fresh subprocesses: six real-file/query combinations, three rotated-order cohorts, and separate timing versus sampled-allocation phases. Every scanner must return exactly equal paths, total, visited count, unreadable count and limit metadata. The baseline is `7c49ca232c13ea1d8bf27da27b2841fa2519bc93`; candidate and experimental variant hashes are recorded. Source hashes are checked before and after each child. Tests and builds do not overlap the cohort.

The flat project contains 40,000 files. The nested project has 16,000 files six levels down and is queried by leaf name, parent name and a slash-crossing path. The deep project has 48 levels with 512 files at each level. Cold is the first call; warm is the median of calls three through seven. Initial diagnostic GC occurs outside measured work; production GC is not changed. Allocation sampling uses a separate twenty-call process with a 16 KiB interval and includes collected objects. Scanner-subtree estimates exclude some native filesystem/runtime allocations and are not retained-memory totals.

| Fixture | Cold baseline → optimized (ms) | Warm baseline → optimized (ms) | Sampled scanner allocation baseline → optimized (MiB / 20 calls) |
| --- | ---: | ---: | ---: |
| flatSparse | 76.00 → 74.05 | 40.64 → 36.95 | not sampled |
| flatDense | 85.73 → 90.51 | 42.17 → 45.87 | not sampled |
| nestedSparse | 61.59 → 54.24 | 17.97 → 22.95 | 178.03 → 90.68 |
| parentMatch | 62.13 → 64.40 | 27.09 → 20.78 | 176.04 → 120.90 |
| pathQuery | 69.40 → 62.35 | 25.11 → 26.61 | not sampled |
| deepWideParents | 131.01 → 105.92 | 49.59 → 44.53 | not sampled |

In the nested sparse case, sampled scanner allocation is about 49% lower. The same case's warm completion time is higher. Other cases also move in both directions. This is evidence for reduced temporary allocation, not a universal throughput or GC-pause improvement. The raw report keeps observed heap high water, process peak RSS, timer gaps and natural GC observations. Some peak-heap/RSS readings increase; less allocation does not prove a smaller whole-app resident set.

## Buffer experiment that did not ship

The third `tapered` variant increases shallow buffers to 512 entries and reduces them with depth, while keeping the same yield interval and complete output. It improves some timings but increases observed heap high water in the 40,000-file sparse/dense cases from roughly 7.5 MiB to 9 MiB. It does not consistently improve nested/deep workloads. The app therefore keeps its existing 256-entry buffer. All experimental observations remain in the report; no cohort is dropped to select a preferred timing.

## Native app comparison

Run `node scripts/performance/filename-native.cjs /tmp/filename-native.json` on Linux with Electron/Xvfb available. The [native report](filename-hot-loop-native.json) records three alternating fresh-instance pairs using the same compiled UI, project files and request manager; only the scanner module differs. The fixture contains 40,008 nested files plus one root entry file. External agent discovery and Git status are fixture-controlled, and the initial Explorer filename index settles before measurements.

Native text input starts each observation. The picker must show its busy state and then the exact current prefix/total. All 42 observations satisfy that contract; 18 file selections additionally verify exact CodeMirror source and editor focus. Six real active scans are cancelled by replacement queries, without an injected wait, and every instance finishes with zero search owners and active searches. Input-to-result-DOM includes debounce and IPC, with no subtraction of the 150 ms debounce. It is not hardware input-to-paint, application startup or a cross-editor comparison.

| Native query | Baseline → optimized result DOM (ms) |
| --- | ---: |
| `target-000000.ts` | 289.60 → 279.50 |
| `target-000007.ts` | 231.00 → 231.20 |
| `src/a/b/c/d/e/` | 268.50 → 256.60 |
| `b` | 274.70 → 271.10 |
| `e/target-000003.ts` | 237.70 → 239.40 |
| `missing-needle` | 210.80 → 208.40 |
| Replacement input after clearing | 231.80 → 225.10 |

These small cohorts show modest gains for some queries and small regressions for others. Keep those limits when discussing speed. The earlier cross-editor chart is not rerun or updated by these experiments.

## Reading and verification

The author-hosted [Dirty Flag chapter](https://gameprogrammingpatterns.com/dirty-flag.html) explains reuse of derived data and its invalidation/retained-memory costs. [Reading scope](filename-hot-loop-reading.json): the complete captured prose and C++ listings were read; images were not inspected, examples were not compiled and the entire book was not read. Here the useful constraint is ownership of immutable inputs within one walk. A persistent dirty-flag index would require a separate filesystem invalidation design and measurement.

[Verification record](filename-hot-loop-verification.json) covers regression tests, Unicode/path cases, type checking and the native cohort. The configured installer allowlist includes runtime directories and built UI; these benchmark harnesses and report files are outside it. The runtime change adds no dependency, worker, diagnostic sampler or native bridge.

## Remaining work

Full scans still enumerate the searchable tree for each completed query. A correctly invalidated bounded index, finer discovery scheduling, and representative filesystem/device tests remain candidates. File contents, dirty buffers and undo history are not reduced to make memory numbers smaller. Broader app RAM, local-model RAM/VRAM, startup and GC behavior remain separate work; this scanner result does not establish completion of those goals.
