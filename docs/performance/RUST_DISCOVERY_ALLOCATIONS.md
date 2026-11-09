# Rust discovery allocation traffic

Recorded on 8 November 2026; published with the README on 9 November. This comparison measures the scanner change committed as `4fbedc196b33efcc45519d24e7b83163bc909374`, not every feature in the current app.

## Change

The existing operation-owned Rust scanner reuses one scratch String for ASCII case matching. It compares a borrowed virtual rel/slash/name path against the bounded heap maximum, allocating an owned path only when it enters the lexical result prefix. Admitted path storage reserves its exact known length. This preserves the complete total/visited/unreadable counts and ordering. Symlink boundaries, depth/limit rules, Unicode fallback, quoting, cancellation and the parent-pipe lifetime are unchanged. There is no new dependency, unsafe production code, custom allocator, persistent cache, additional service or forced collection.

The native build script runs two Rust semantic unit tests before replacing/building the helper on each configured native target. The tests compare against owned-string lexical ordering and the original lowercased matching semantics, including root/nested prefixes, reverse admission, boundaries, casing and control characters. Linux x64 is tested locally; other runner/platform outcomes are not claimed.

## Allocation diagnostics

Separate diagnostic helpers use an identical System GlobalAlloc wrapper to count successful allocation/reallocation requests, cumulative requested bytes and peak live requested bytes. These are Rust GlobalAlloc requests including std use; they exclude libc allocations bypassing it, allocator overhead and kernel pages. The wrapper contains diagnostic-only unsafe allocator plumbing, absent from production. Diagnostic runs are not timed or used as RSS evidence.

Three separate trees each contain 20,008 empty files with identical names but different creation order. Actual enumeration order belongs to the filesystem and is not assumed to differ; identical allocation counts across these trees are retained. Six query/limit cases per tree produce 36 diagnostic runs (18 before/after pairs), each with exact output verification. All file prefixes, summary counts and wire hashes are checked.

| Query | Limit | Allocation requests before → after | Cumulative requested bytes before → after | Peak live requested bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| source- | 100 | 120,135 → 41,818 | 2,399,639 → 725,391 | 16,530 → 15,262 |
| group | 100 | 100,151 → 41,817 | 2,080,053 → 725,357 | 16,528 → 15,244 |
| /group3/ | 100 | 120,150 → 40,528 | 2,620,205 → 690,576 | 16,531 → 15,271 |
| target- | 100 | 60,155 → 40,117 | 994,439 → 673,828 | 9,970 → 9,914 |
| missing-needle | 100 | 60,129 → 40,107 | 993,598 → 673,315 | 9,465 → 9,497 |
| source- | 2000 | 120,139 → 49,879 | 2,491,800 → 1,035,091 | 138,611 → 112,643 |

Allocator requests fall about 33–66%; cumulative requested bytes fall about 32–74% across these cases. The missing-query peak rises by 32 requested bytes because the reusable buffer remains live until operation end. These figures are allocation traffic/representation evidence, not an app-RAM saving or additive to other optimization reports.

## Uninstrumented CLI comparison

Fresh same-compiler/profile baseline and production candidate helpers were measured separately from diagnostics: five alternating pairs per query/tree, 180 fresh CLI executions total. No tests, builds or other performance cohorts overlapped. Every output was verified. Parent elapsed includes GNU time/helper startup, pipe output and child exit, and excludes parent JSON parsing. Maximum RSS is the kernel child-process high-water result reported by GNU time. CLI requests omit the app parent-pipe flag; the real app ownership path is tested separately. Filesystem cache is warm. This is not GUI latency, cold storage, full-app peak RAM or a VS Code ranking.

Compiler: rustc 1.86.0 (05f9846f8 2025-03-31); target x86_64-unknown-linux-gnu. Release profile: opt-level 3, thin LTO, one codegen unit, panic abort, stripped normal binaries. Baseline was freshly built in an isolated crate with the identical Cargo manifests/profile; candidate is the exact current built helper. Hashes and normal artifact sizes are bound in verification.json. The initial before-engine copy/baseline.json is retained for provenance; ordinary.json identifies the fresh measured base-engine binary.

| Tree creation order | Query | Limit | Median CLI ms before → after | Median max RSS KiB before → after |
| --- | --- | ---: | ---: | ---: |
| ascending | source- | 100 | 32.752 → 21.498 | 2,088 → 2,072 |
| ascending | group | 100 | 27.746 → 29.981 | 2,024 → 2,068 |
| ascending | /group3/ | 100 | 22.896 → 20.058 | 2,160 → 2,028 |
| ascending | target- | 100 | 26.503 → 24.999 | 2,152 → 2,172 |
| ascending | missing-needle | 100 | 27.603 → 23.142 | 2,064 → 2,068 |
| ascending | source- | 2000 | 46.321 → 37.670 | 2,280 → 2,156 |
| descending | source- | 100 | 41.526 → 33.155 | 2,152 → 2,084 |
| descending | group | 100 | 36.294 → 29.890 | 2,088 → 2,060 |
| descending | /group3/ | 100 | 36.791 → 32.710 | 2,024 → 2,184 |
| descending | target- | 100 | 33.450 → 23.825 | 2,024 → 2,160 |
| descending | missing-needle | 100 | 28.944 → 25.776 | 2,152 → 2,072 |
| descending | source- | 2000 | 31.598 → 33.266 | 2,276 → 2,200 |
| shuffled | source- | 100 | 35.748 → 24.627 | 2,144 → 2,024 |
| shuffled | group | 100 | 25.887 → 24.402 | 2,032 → 2,068 |
| shuffled | /group3/ | 100 | 27.719 → 20.770 | 2,280 → 2,068 |
| shuffled | target- | 100 | 28.645 → 23.144 | 2,024 → 2,044 |
| shuffled | missing-needle | 100 | 24.029 → 25.031 | 2,088 → 2,064 |
| shuffled | source- | 2000 | 45.827 → 38.941 | 2,216 → 2,184 |

Fifteen of 18 case medians improve. Three worsen: ascending group/100, descending source-/2000 and shuffled missing-needle/100. Kernel maximum RSS is mixed near 2 MiB. Shared-machine scheduling and page residency limit causal timing/RSS precision. The robust scoped benefit is fewer allocator requests/cumulative requested bytes with unchanged results; no universal faster/lower-RAM claim is made.

## Verification and reading

- Recorded source tree: 726 tests passed, no skips/failures; two Rust unit tests also pass through the updated native build script.
- Clean-main publication candidate: 14 focused native-search/distribution tests passed, no skips. Only the two source/build files differ; held refresh work is excluded.
- Real native/JS filesystem, error/fallback and cancellation parity: 18 groups; transport lifecycle: 7; blocked-output/owner-crash checks: 3.
- Actual isolated workbench with 21,001 searchable source files: seven functional checks pass, including exact source opening and owner cleanup. Three successful queries are explicitly asserted to use real native results, rejecting silent fallback. The existing fixture uses four deliberately held producers for UI cancellation lifecycle; actual native child cancellation is covered by parity separately.

A separate parser-only experiment was held after ordinary opening times worsened. It is not part of this scanner comparison.

rust-discovery-allocation-evidence.tar.gz retains raw reports/logs, failed restricted attempt, compiler/version/build records, normal/diagnostic binaries and source, fixture generation/query manifest, measurement/retention drivers, source/verifiers and the native UI screenshot. Empty fixture trees and compiler target directories are not archived; the captured driver/seed recreates them. The evidence index binds source/archive hashes. The linked archive and index are published with this report. These results do not cover broader app/model RAM, GC latency, other platforms or a current cross-editor comparison.

## Publication

The code change is commit `4fbedc196b33efcc45519d24e7b83163bc909374`; exactly the Rust source and native build script changed. Later app changes are outside this frozen measurement. At that time, installer run 42486359644 passed validation but failed artifact upload due to storage quota; that historical distribution failure is not a scanner performance result or a statement about current installer availability.

- [Summary](rust-discovery-allocation-summary.json)
- [Raw results, drivers and frozen source](rust-discovery-allocation-evidence.tar.gz)
- [Archive/member hashes](rust-discovery-allocation-evidence-index.json)
- [Code publication receipt](rust-discovery-allocation-publication.json)

Run `python3 scripts/performance/verify-published-benchmarks.py` from the repository root to check hashes and recalculate the headline results without running a new benchmark.
