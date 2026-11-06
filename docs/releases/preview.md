Tributary preview for macOS, Windows and Linux.

### Downloads

- macOS: choose `arm64` for Apple Silicon, `x64` for Intel. DMG installer and ZIP.
- Windows: choose `x64` for most PCs, `arm64` for Windows on Arm. Setup EXE and ZIP.
- Linux: choose `x64` for Intel/AMD PCs, `arm64` for ARM systems. AppImage, Debian package and tar.gz.
- Verify downloads against `SHA256SUMS.txt`.

### Included

In this update:

- Reduce temporary filename-search allocation by reusing directory continuations and parent matches. Unicode/path semantics, complete results and real cancellation are checked; native response-time gains are modest and workload-dependent.
- Find files beyond the former 20,000-entry cutoff. Quick Open and Explorer searches now stream directory entries, show limited-result totals, cancel obsolete work, and release searches when their view closes or reloads. Admission and result storage are bounded; isolated measurements document both memory savings and the single-scan throughput tradeoff.
- Keep image tabs open with lower memory use: inactive raster tabs and file watches hold metadata, visible split views share preview resources, and hidden/closed views release them. Native checks cover image formats, live changes, error recovery and restoring tabs. Measured six-image results and their limits are documented in the image ownership report.
- Chat and Markdown galleries release offscreen image data while preserving known layout and keyboard/dialog ownership. Duplicate references share resources; explicit retries stay fresh. The gallery report records retained-heap savings alongside slower revisits and mixed whole-app memory checkpoints.
- Scan editor change markers and line counts once, with less temporary parser allocation and complete marker coverage beyond the review UI's 2,000-row limit. Real Git, undo and watched-file updates are checked; isolated parser measurements remain separate from whole-app memory claims.
- Read project `.vscode/settings.json` and language overrides; run project-local ESLint diagnostics, undoable right-click fixes and independent fix-on-save. Install/setup ESLint per workspace folder from Language tools.
- Load files asynchronously while preserving dirty buffers; resolve nested monorepo Prettier runtimes and plugins from each file’s package.
- Verify uploaded installer and checksum-file digests before publishing or accepting a completed retry. Workflow summaries link directly to the published downloads.
- Hide and reopen the file explorer from the workbench toolbar or Ctrl/Cmd+Shift+E without closing files, losing undo history or leaving the focused layout.
- Agent editor controls, independent split groups and live buffer edits, with line-ending normalization for CRLF/Unicode updates.
- Project-rule formatting on save now writes requested CRLF/LF output correctly, keeps native undo and shows the saved file’s line endings.
- Quick Open takes focus before typing begins; closing it or finishing a delayed file load cannot take focus from a newer search or picker.
- A shorter visual README with actual repository screenshots, an animated brand illustration, benchmark charts, reproducible results and contributor guidance.
- Automatic versioned previews after successful main pushes; complete six-platform builds and checksums are uploaded before the release becomes visible.
- A complete large-project navigation comparison with VS Code and Zed: the same 20,008 source files, verified contents, all nine fresh instances, raw observations and software-graphics limits. It records where other editors do better. Historical Tributary allocation optimizations are documented separately.

New in 0.1.3: guided local-model setup for Unsloth, Ollama and LM Studio; model discovery, API-key setup and local chat or coding agents with file tools, command approvals and background workers; resume controls after network interruptions; a compact Notes/Context/Activity memory panel; compact history/project-memory budgets; and smaller sidebar status caches that keep full replies on disk until opened. Model downloads, loading and GPU memory remain managed by the local model app.

Local coding agents and background teams, LAN project rooms, a multi-folder workspace, live file edits, Git comparisons, project-aware formatting, terminal, debugger, preview browser and QA tools.

New in 0.1.2: Help → Check for updates, in-app installer downloads with SHA-256 verification and cancellation, optional automatic checks, and private GitHub access stored using OS credential protection. Save your edits, open the installer, then reopen Tributary. AppImage users replace the verified download manually. Upgrading from 0.1.1 requires this one manual installation first.

Also includes an Ocean blue workbench palette (Appearance → Workbench colors), automatic device detection for keyboard shortcuts, and uninstall instructions for every download format.

### Preview limitations

These builds are not developer-signed or notarized. macOS builds use ad-hoc signatures; macOS Gatekeeper and Windows SmartScreen may warn or block installation. Apple Developer notarization and Windows code-signing certificates are required before a signed public release.

Git is required for repository features. Install/sign in to the coding agents you want to use, or configure a supported model gateway. OpenSSL is required to create the first LAN hosting certificate. Language formatters and language servers are optional project tools.

Each architecture's packaged runtime, SQLite, native terminal and bundled formatter are checked on its build runner. Installer GUI and physical-device testing are separate from these automated checks.

This repository is private; GitHub downloads require repository access.

### Uninstall

Windows: Settings → Apps → Tributary → Uninstall. macOS: move Tributary.app from Applications to the Trash. Linux `.deb`: `sudo apt remove tributary`. For portable archives/AppImages, delete the extracted app or AppImage. Project folders are kept. [Full uninstall instructions and optional app-data cleanup](https://github.com/DarkWorldCoder/tributary/blob/main/docs/UNINSTALL.md).
