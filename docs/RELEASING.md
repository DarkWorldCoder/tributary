# Preview releases

The [Distribution workflow](../.github/workflows/distribution.yml) runs on pushes to `main`, version-tag pushes, and manual dispatch. A successful main push receives a numeric patch version and all macOS/Windows/Linux x64/Arm64 builds. Failed validation or packaging does not publish an incomplete preview.

## What happens

1. Resolve the exact pushed source SHA and allocate the next `vX.Y.Z` version above existing numeric tags, or use a deliberately higher package version.
2. Set the root, UI and extension package/lock versions in each build checkout. Run regressions, type checking and a clean UI build.
3. Build six native platform/architecture variants, verify their packaged runtime, SQLite, PTY and formatter, and collect all 14 downloads.
4. Create a release snapshot commit whose parent is the pushed source, containing only the prepared manifest changes; tag it without changing `main`. The commit records `Tributary-Source: <SHA>`.
5. Validate the exact artifact set, hash files with a bounded 64 KiB buffer, upload into a draft prerelease, verify remote asset names/states/sizes, then publish. `SHA256SUMS.txt` accompanies the downloads.

All workflow runs share one queued release group, so concurrent pushes do not allocate the same version. GitHub's `queue: max` supports up to 100 pending runs; failed runs, disabled Actions, quota/queue limits and permission restrictions still require maintainer attention. This is release-on-success, not a promise that failed commits get downloadable installers.

Tag pushes made by this workflow's `GITHUB_TOKEN` do not recursively trigger another workflow. There is no automated commit or push back to `main`.

## Retry

For an interrupted run, use GitHub Actions → Distribution → Re-run jobs. A rerun reuses a tag already associated with the same source. Existing tags with different content are refused; tags are never forced. Only unpublished draft assets may be replaced. An already published release is checked for the complete expected asset names and sizes and left unchanged; a mismatch fails for manual investigation. This check is not a byte-for-byte comparison with rebuilt installers, which can contain nondeterministic metadata.

Manual dispatch with an empty tag releases the selected main commit. A supplied tag must be a numeric version matching its package metadata and must contain the current release tooling; older previews created before this automation use their historical tag workflow. Do not use manual dispatch from an arbitrary feature branch to publish a release.

## Downloads and trust

Previews are marked as prereleases. Link to [Releases](https://github.com/DarkWorldCoder/tributary/releases), since GitHub's `/releases/latest` excludes prereleases. Downloads currently require access to this private repository. Publishing a preview does not change repository visibility.

The pipeline checks the packaged runtime on each native runner. It does not certify installer GUI behavior, physical-device support or production readiness. macOS uses ad-hoc signing; developer signing, notarization and Windows signing remain future work.

[Update behavior](APP_UPDATES.md) · [Removal and data cleanup](UNINSTALL.md) · [Preview notes](releases/preview.md)

Primary references: [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) and [workflow token triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
