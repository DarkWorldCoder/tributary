# File-tree retention

The active folder context stays warm. Trees belonging to other visited projects or selected workspace-folder contexts release rendered rows, component state, page arrays and compact-folder peek promises. Existing FolderFiles owners remain mounted to retain dirty editor state, pending saves/formatters, file-creation dialogs and operations.

Small per-root sessions retain page-count intent, keyboard focus path and the previous active path. Scroll restoration stores a root-qualified path, viewport offset and scroll coordinates. It uses at most four hit tests during capture; no row node survives in that record. An active-only observer follows asynchronous page/child insertion and disconnects on real tree interaction or hiding. A returned tree revalidates actual disk data; it does not reuse stale entry arrays. Completing a cancelled page cannot resume the old pagination loop.

## Paired measurements

[Full raw evidence](tree-retention-pairs.json). Baseline: `04807e2`, with the same current search UI/core and only the tree-retention change absent. Three alternating fresh Linux Electron pairs, six actual temporary projects, 520 source files plus 40 nested files each. Five post-diagnostic-GC samples per phase, medians within each process then across three processes. No other benchmark/test suite ran concurrently. Source hashes are checked before and after.

| Phase | Retained renderer heap, MiB | Process-tree PSS, MiB | DOM nodes |
| --- | --- | --- | --- |
| six-expanded-projects | 115.24 → 33.72 | 494.36 → 382.08 | 28,944 → 6,389 |
| after-one-return-pass | 116.44 → 34.59 | 502.46 → 392.58 | 29,061 → 6,416 |
| after-three-return-passes | 116.91 → 35.15 | 496.94 → 395.95 | 29,061 → 6,416 |

Rendered tree rows are 3,378 → 563 throughout these phases. These are retained-memory measurements after diagnostic renderer GC, not production peak RAM, model/VRAM measurements or cross-platform proof. Normal app code does not force collection. Raw pre-GC snapshots are also included; they are not a separate GC-free session because earlier phases collected diagnostically, and contain allocations awaiting collection. Linux PSS is a non-atomic sum across the current process tree.

## Cost and behavior

The restore workload performs 90 → 108 directory reads (+20%). Median time to the selected conversation header, Files tab and root row was 1,362 → 426 ms in this fixture, including a fixed 150 ms panel settling wait. This does not measure complete tree rebuild latency or establish a general app speedup. Current-context Files/Memory switching keeps the same live tree; returning to another context reconstructs its loaded pages. One context can contain several roots. This is not active-tree virtualization or a bound on retained dirty documents, undo state, all project owners, session path metadata or model memory.

Native assertions pass in all three changed runs: restored loaded pages/expanded branches, exact dirty text, scroll anchor, keyboard focus, same-context identity, late page completion cancellation, file-creation draft and actual delayed disk creation, two workspace roots with duplicate relative paths, and a file added externally while hidden. The delayed creation/context-switch case uses host events while a modal is open to exercise operation ownership; it is not an ordinary click-through-modal interaction. Unit checks also cover removed anchors and immediate interrupted Show-more intent.

Full regression suite: 557 passed. TypeScript, production UI build and VS Code bundle build pass. Neither Windows/macOS native windows nor distribution installers were exercised. Fixture agent discovery is stubbed; no providers or local inference services run.

Reproduce with `npm run bench:tree-retention -- /absolute/frozen-control-host /absolute/report.json`. The host needs the baseline desktop and built UI plus matching dependencies. Failure logs stay in the printed temporary evidence directory.
