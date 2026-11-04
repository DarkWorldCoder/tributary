# Review test evidence

Open **Tests → Import report**. Choose a project-relative Playwright JSON report or upload its JSON. Set environment/build labels if known; Tributary does not infer them from the current branch.

1. Generate real results with Playwright's JSON reporter. Importing never runs tests or downloads a tool.
2. Select a failed or flaky case. Review every attempt, assertion, step and captured output.
3. Use **View** for retained PNG/JPEG/WebP screenshots. **Open trace** launches the project's installed Playwright viewer on loopback; executing that installed CLI requires a trusted project.
4. Use **Create bug report** to add expected behavior and reproduction steps, then copy or save Markdown. The export identifies local evidence by hash; attachments are not bundled.

Passed, failed, flaky, skipped, blocked, not-run and expected-failure remain separate. An empty or incomplete report cannot become a passing run. Retries retain earlier failures. Missing evidence is labeled unavailable.

Results and copied evidence persist separately for each local project. Removing a saved run removes its imported record and snapshots, not the original test files. Exact duplicate imports reuse the saved record; to recover evidence missing during import, restore the files, remove that saved run and import again.

Limits: 16 MB input, 2,000 cases, 20 attempts per case, 20 saved runs per project, 16 MB per artifact and 32 MB retained evidence per run. Error/output text is bounded; keep the original report for complete logs. Paths and symlinks outside the selected project are not read. SVG/HTML/video and other attachments are not supported in this slice.

This is an evidence-review foundation. Automatic test generation/execution, browser recording, API collections, accessibility scans, visual baseline approval, CI adapters, issue-tracker publishing and evidence bundles remain follow-up work.
