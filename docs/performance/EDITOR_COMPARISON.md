# Cross-editor large-project navigation

This experiment exercises **Tributary, VS Code and Zed**, using the same generated project and externally delivered X11 input. It is separate from Tributary’s historical allocation optimization experiment.

The [completed cohort](editor-comparison.json) contains all nine passing instances, all 54 small-file and nine large-file observations, source/build fingerprints and 45 complete process-tree samples. [The results table](../../BENCHMARKS.md#cross-editor-large-project-navigation) includes observed ranges and the slow first Tributary search. Medians are descriptive; no observations are discarded as outliers.

Asynchronous file loading, project-local ESLint and subsequent per-file formatter selection were added after this measured build. Their functional checks do not refresh this cohort or establish a performance improvement.

## What completion means

- **Quick Open:** invoke the file picker, enter a unique filename, open it and confirm the complete source buffer through the X11 clipboard. The selected text must match the fixture exactly.
- **Large file and EOF navigation:** open the same 40,001-nonempty-line file and confirm its exact first and final nonempty source lines with native Home/End navigation and clipboard selection. A matching filename or query alone cannot pass.
- **Settled PSS:** separately sample the complete application process tree after the navigation work. Reject incomplete accounting. No explicit GC, heap debugger or profiler runs.

The seven small target files and large file are at the project root; background files are nested under `src`. Tributary’s current filename walker stops after 20,000 visited entries. This experiment verifies the stated target files, not search coverage of every fixture file or equal indexing behavior across editors.

Each fresh application uses isolated app data/config/cache/home directories and an unavailable session bus. VS Code’s AI features and TypeScript language-feature extension are disabled, Zed’s external language servers are disabled, and Tributary’s provider discovery is disabled. No AI generation runs. Third-party extensions are absent. Built-in parsing and product behavior differ. All three use dark themes. The same fixed 1280×900 virtual display and project files are used. The fixture is committed to a clean Git working tree, so the experiment does not compare how editors enumerate thousands of untracked changes. OS file-cache contents are warm; this does not measure cold startup. The source/build and fixture identities must remain unchanged throughout a cohort.

A file-picker focus/control failure in an exploratory pilot is not an editor-performance result. Exploratory Find handling was excluded because focus semantics differed across editors. The final cohort contains only the two verified navigation tasks above.

Picker visibility is detected through a changed top-center image region. Its exact query is acknowledged through the clipboard and the display region settles in 120 ms intervals before selection. Source verification also requires clipboard processing, focusing the source pane and polling. Repeated same-buffer verification controls quantify part of that overhead and are not subtracted from task timings. These costs are included, so the timings are **coarse end-to-end workflow observations**, not exact input-to-paint latency or rendering frame rates. Differences near that observation overhead should not be interpreted as meaningful wins.

## Retained failed cohort

The first large-project cohort stopped during Tributary’s second instance: opening Quick Open again could send the first letter into the source before the input took focus. [The complete incomplete-run report](editor-comparison-focus-failure.json) and [failure screenshot](editor-comparison-focus-failure.png) are retained. Its successful cases are not pooled into the replacement cohort or its chart.

The correction focuses the picker at DOM commit, prevents a stale close callback or late file load from taking focus, and restores keyboard focus after selection/cancellation. A native regression exercises repeated rapid reopen cycles and a delayed file read. The replacement cohort starts all nine instances again. It also uses clean tracked Git files and fixed dark themes; the failed cohort had untracked fixture files and inherited theme behavior. It therefore provides debugging evidence, not a paired performance baseline for the correction.

## Graphics boundary

Xvfb has no hardware presentation path. The environment requests software graphics, and Zed explicitly warns that its emulated Vulkan renderer can perform poorly. Chromium and Zed use different rendering backends. These results must not be promoted as a general ranking of desktop responsiveness or hardware-GPU performance.

Versions, source fingerprints, per-run observations, fixture details and accepted/rejected process samples belong in the companion report. A source build of Tributary is compared with the installed VS Code and Zed builds; this is not three matched release packages. No claim covers semantic language-server performance, real monorepo tooling, remote workspaces, active extensions or AI inference.

The desktop host is not a dedicated laboratory machine. Agent-launched builds, tests and other benchmarks are stopped during the cohort, but ordinary background system activity can remain. Per-instance load averages are retained. Three instances per editor support descriptive observations, not statistical confidence or a universal product ranking.

## Reproduction

Requires Linux procfs, Xvfb, libX11/libXtst, Python 3 with Pillow, Node.js, built Tributary UI, and installed VS Code/Zed at the paths recorded in the driver. Use a temporary Python environment; Python packages are not app runtime dependencies.

```sh
xvfb-run -a -s '-screen 0 1280x900x24' python3 scripts/performance/editor-comparison.py \
  --output /tmp/editor-comparison.json --runs 3 --files 20000
```

Run serially without concurrent builds, tests or other agent-launched benchmarks. The driver rotates application order, uses real generated files, verifies bytes, keeps raw per-operation results and refuses changed source/builds. Its temporary directory retains application logs, screenshots and accounting diagnostics for inspection; remove that directory after preserving the intended report. Failed pilots are debugging evidence and must not be mixed into the final result cohort.

[Driver](../../scripts/performance/editor-comparison.py) · [External display/input probe](../../scripts/performance/x11-input.py) · [Tributary host](../../scripts/performance/native-comparison.cjs)
