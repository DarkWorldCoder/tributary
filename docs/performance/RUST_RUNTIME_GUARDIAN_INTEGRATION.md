# Integrated Rust runtime ownership

Recorded on 8 November 2026; published with the README on 9 November. The integrated code is commit `c532d741265c1563341572fdc5d85598def9ac7e`, based on `4fbedc196b33efcc45519d24e7b83163bc909374`. Later app changes are outside this frozen comparison.

## Result

A checked native owner replaces the extra Electron Node-mode guardian while a local model runs. In three alternating fresh Linux desktop pairs, every active checkpoint used less total process-tree PSS: 5.38–20.10 MiB within pairs. Median idle app/model memory fell **456.803 → 439.785 MiB**, a 17.018 MiB difference between variant medians. Before-start and after-stop controls were mixed. This is a scoped working-set improvement while a runtime is owned, without changing model precision, context or generation settings.

| Settled boundary | Legacy tree MiB | Integrated tree MiB | Legacy guardian MiB | Native guardian MiB |
| --- | ---: | ---: | ---: | ---: |
| Desktop before start | 318.092 | 318.133 | 0 | 0 |
| First generation | 1019.169 | 1003.138 | 32.760 | 0.611 |
| Model sleeping | 456.803 | 439.785 | 32.799 | 0.611 |
| Catalog while sleeping | 472.513 | 454.235 | 32.769 | 0.611 |
| Second generation | 1035.696 | 1017.907 | 32.774 | 0.611 |
| After stop | 397.708 | 398.009 | 0 | 0 |

Each cell is the median of three app-level medians; each app-level median uses five complete samples. PSS accounts shared mappings proportionally, so the approximately 32 MiB guardian difference cannot be subtracted directly from total app memory. No previous idle-unload saving is added to this result.

## Implementation

- One native child owner inside the existing discovery executable, using `shared_child` synchronization to avoid signaling reused process IDs. Small dedicated stacks and an explicit 8 KiB forwarding buffer keep ownership overhead bounded.
- Private parent pipe controls graceful and force shutdown; parent death closes it. Unix repeated termination signals retain their handler until cleanup. Graceful stop escalates after a one-second deadline. This is not a hard real-time guarantee.
- Private cwd cleanup needs an explicit ownership grant and the expected private directory prefix. Ordinary workspaces are preserved. Cleanup guards cover normal error exits; they cannot promise destruction after the guardian itself receives SIGKILL, aborts or is OOM-killed.
- A checked identity probe verifies protocol, runtime support, OS and architecture. Missing or incompatible helpers use the original JavaScript owner only after the probe closes. Once native runtime ownership starts, failure never launches a second model through fallback.
- Bounded metadata and output streams preserve binary/Unicode output, argv boundaries, slow-reader exit behavior and cancellation while output is paused. The native process handles the platform lifecycle; HTTP/prompt/model behavior stays in its existing owner.
- Cargo.lock pins seven registry packages. Build/test use `--locked`; cached offline builds were verified with `CARGO_NET_OFFLINE=true`. Committed dependency license bytes and manifest are checked before packaging and copied into native resources.

No production forced GC, custom allocator, new prompt/history cache or heap cap was introduced. Application Rust adds no unsafe blocks; dependencies contain platform FFI. This is not a complete dependency security audit.

## Verification

All local commands and cohorts finished before this record was made.

| Check | Evidence |
| --- | --- |
| Clean publication regressions | 739 passed, zero failed/skipped |
| Rust tests and locked release build | 2 Rust tests passed; final offline build passed |
| TypeScript and production UI build | Passed in the clean publication candidate |
| Runtime ownership groups | 19 passed on Linux, covering fallback/cancel/crash/repeated signal/backpressure/cleanup/argv cases |
| Discovery compatibility | 18 parity groups passed |
| Native transport and parent ownership | 7 transport and 3 owner/crash/backpressure checks passed |
| Electron ASAR | Actual Electron Node mode selected and reaped both native and missing-helper JavaScript paths |
| Desktop UI | 5 isolated synthetic authenticated lifecycle checks passed, including native selection, streaming, startup cancel, restart and ordinary quit |
| Linux application directory | Built and verified packaged runtime, SQLite, native discovery, terminal, formatter and lint transport |

The 19 ownership groups are included in the 739 regressions, not additional to that total. An earlier dirty-root run passed 745, including six held refresh tests; the publication run deliberately excludes held changes. Linux package verification does not certify AppImage/deb installers or Windows/macOS builds.

Local lifecycle verification covers Linux. The workflow later added the ownership gate to all six target jobs in `9345340`; that configuration does not establish that the measured change passed on every platform. Historical CI state is preserved in the publication receipt; it does not certify a current installer.

## Measurement design and limits

Six actual source Electron apps used the same clean UI/core candidate. The legacy control overrode only its launcher with frozen pre-change owner files; the integrated candidate used the actual checked production path and asserted native selection. Held refresh work was absent from both.

Each app made two real capped CPU-model replies, checked sleeping/catalog/wake behavior, explicitly stopped, and reaped both runtime and guardian. Settings: CPU 2, GPU 0, context 4096, one slot, batches 128/64, cache RAM 0, idle 2 seconds, output cap 16. Installed-agent discovery and automatic update polling were disabled equally in the fixture. No debugger, profiler, heap snapshot, forced GC or concurrent local build/test/performance cohort ran during sampling.

- llama.cpp b12110, commit `cd959bae99ff4bed22bef2604f45241c09bbb8c8`.
- Qwen2.5-0.5B-Instruct Q4_K_M, revision `9217f5db79a29953eb74d5343926648285ec7e67`.
- Runtime archive SHA-256: `368227edcc229be5f9bed16a2223d79b5e41d0ac2e19bcf5825e82291c060e55`.
- Model SHA-256: `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
- Six boundaries × five complete samples × six apps = **180 complete process-tree PSS samples**.
- One partial `/proc` sample encountered ESRCH and was retained/excluded by the predeclared complete-sample rule. No app run failed or was retried/excluded.

These are settled checkpoints on one Linux CPU configuration, not continuous peaks, machine-wide RAM, a confidence interval, model quality, throughput, installed-release or cross-editor speed evidence. This change does not establish that Tributary is faster than VS Code. Broader large-project latency, renderer/model memory and literature work remain open.

## Evidence and reproducibility

- [Summary](rust-runtime-guardian-integrated-summary.json): all app medians and paired differences.
- [Raw evidence](rust-runtime-guardian-integrated-evidence.tar.gz) and [hash index](rust-runtime-guardian-integrated-evidence-index.json): 114 digest-verified reports, logs, screenshots, drivers, final source files and native executable; includes initial failed test controls.
- [Exact measured source](rust-runtime-guardian-integrated-measured-source.tar.gz): the pre-format source/binaries, separately hashed in the index.
- [Code publication receipt](rust-runtime-guardian-integrated-publication.json): commit/path receipt, source hashes, native binary hash and historical remote snapshot.

Run `python3 scripts/performance/verify-published-benchmarks.py` from the repository root to check hashes and recalculate the headline results without running a new benchmark.

Staging found trailing EOF blank lines in two new files. Those blank lines alone were removed after measurement. The publication manifest maps both source hashes; the final Rust rebuild was byte-identical to the measured executable (`1603b662bae0cd5efeaac18ff2cfdc8b5937c4a296f045d53ca5f04436827028`). No post-measurement runtime behavior change is hidden by this formatting step.

The earlier prototype's failed global-stdout-copy approach and test payload failures remain in its separate historical evidence. This integration also retains an initially failing test-control mock, corrected by scoped restoration, and the final passing suite. No model weights, runtime download archives, private app profiles, credentials, node_modules or full Electron distribution are duplicated into the evidence archive.

Earlier prototype numbers belong to a different cohort and are not pooled into this comparison.
