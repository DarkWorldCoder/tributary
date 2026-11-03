# Project checks

Open **Project checks** in the editor status bar, choose **Lint, type check & tests** in the file menu, or search **Problems and project checks**.

JSON/JSONC and CSS/SCSS/Less get live diagnostics while typing, including unsaved drafts. JSON, CSS-family and HTML files get language-service completions. Basic `package.json` field types are checked; `tsconfig*.json` permits comments and trailing commas. HTML currently has completions, not built-in validation.

Live assistance uses Microsoft's open-source [JSON](https://github.com/microsoft/vscode-json-languageservice), [CSS](https://github.com/microsoft/vscode-css-languageservice) and [HTML](https://github.com/microsoft/vscode-html-languageservice) language services in one lazy worker. It parses text without loading project plugins or fetching remote schemas. Files over 512 Ki characters are skipped. Stale responses are discarded when the draft or file changes.

For project-wide checks, choose a tool and press **Run**. These use saved files. Select a problem to open its file at the reported line. Filter by filename, message, source or severity. Editing a draft or receiving a newer disk version clears stale saved-file markers; rerun to refresh the result.

| Project | Discovered checks |
| --- | --- |
| JavaScript / TypeScript | Configured `lint`, `typecheck`, `type-check`, `check`, `format:check`, `test`; local ESLint and TypeScript fallbacks; configured/local Biome, Oxlint, Stylelint |
| Markdown | Configured/local Markdownlint CLI2 |
| Rust | Cargo Clippy and formatting check |
| Go | Go vet, Staticcheck; configured Golangci-lint v2 |
| Python | Ruff; installed/configured Pyright; configured Mypy, Pylint and Flake8 |
| SQL | Configured SQLFluff |
| Terraform | TFLint when Terraform files or its config are present |

Local Node packages and Python `.venv` tools take precedence over PATH where supported. Configured scripts use the lock-file package manager. Tributary never installs these linters automatically. Check adapters avoid fix/write flags; project scripts execute whatever the project defines. The renderer supplies a catalog ID, never a free-form command.

Structured ESLint, Ruff, Cargo, Stylelint, Pyright, Pylint, SQLFluff, Staticcheck, Golangci-lint, TFLint, Oxlint and Biome Reviewdog output populate Problems, alongside TypeScript and common `file:line:column` output. Unrecognized output remains under **Output**. Paths outside the selected workspace are excluded from clickable diagnostics, including existing external symlinks.

**Stop check** terminates the process tree. Checks have a two-minute timeout, 2 MB output limit and 500-problem display limit. One check runs per workspace. Closing Problems retains the running check/result for the session. App shutdown stops checks.

Verification: 261 regression tests passed; live editor errors, completion insertion and filtering were exercised in an isolated Electron window at 320, 390, 768, 900, 1280 and 1920 px. Real Biome 2.6.4, Oxlint 1.90.0 and TypeScript checks were exercised. Other adapters have discovery/output fixture coverage; their installed toolchains and Windows/macOS execution were not exercised. No VS Code extension host or general LSP client was added.
