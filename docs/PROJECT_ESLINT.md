# Project ESLint and editor settings

Open **Settings → Language tools → Project ESLint**. Choose the workspace folder, then **Install ESLint** if needed. Tributary detects npm, pnpm, Yarn or Bun from package metadata/lockfiles and shows the exact command and target folder before **Run in terminal**. For an unconfigured installed project, **Create config** opens ESLint’s interactive initializer. Installs may download packages and update dependency files; opening settings or files never installs anything.

Use the project’s compatible ESLint version and required parsers/plugins. TypeScript projects need a TypeScript-aware config, such as `typescript-eslint`; merely installing ESLint does not enable every language. Yarn Plug’n’Play, global ESLint and libraries resolved outside the selected workspace root are not supported by this bridge.

## Live problems and fixes

- Open a JavaScript/TypeScript file to see real ESLint diagnostic ranges alongside the existing syntax and language-server diagnostics. Configured Vue/Svelte/Astro/JSON/MDX/CSS plugins can also validate the corresponding supported file types.
- Right-click → **Fix ESLint problems** applies available fixes to the draft. **Undo** restores the previous buffer. Save separately.
- `eslint.run: "onSave"` checks on opening, saving and explicit refresh, instead of every edit. A delayed response is ignored when its document or editor owner is no longer current.
- Saving ESLint config or `.vscode/settings.json` in Tributary revalidates active lint editors. Typing, saving or returning focus reads changed settings. Use **Restart ESLint** after editing imported config helpers/plugins whose files are not directly tracked, or after installing packages.
- Opening a file never formats it. Disk changes update clean buffers; unsaved working copies retain the existing conflict/recovery controls.

## Project settings

The selected root’s **`.vscode/settings.json`** accepts JSON comments, trailing commas and language scopes such as `[typescript]` or `[typescript][typescriptreact]`. For example:

```jsonc
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.run": "onType",
  "[typescript]": { "editor.formatOnSave": false }
}
```

Here TypeScript still receives ESLint fixes on save, while automatic formatting is disabled for that language. Project format-on-save overrides the app default. ESLint code actions are independent from formatting; set `source.fixAll.eslint` to `false` or `"never"` to disable them. The editor’s explicit saves recognize `true`, `"explicit"` and `"always"`; there is no separate focus-change autosave policy in this integration.

Supported ESLint settings are `eslint.enable`, `eslint.validate` (language-ID array), `eslint.run`, `eslint.quiet`, `eslint.useFlatConfig`, `eslint.format.enable` and `eslint.workingDirectories`. Working-directory entries accept local directory strings, `{ "directory": "./packages/app", "!cwd": true }`, `{ "mode": "auto" }`, `{ "mode": "location" }`, or in-root `*`/`**` patterns. The most specific matching explicit directory wins, retaining the first equal match. By default the nearest flat config determines the ESLint working directory; auto mode also considers package/legacy config markers.

To use ESLint as **Format document**, select `"editor.defaultFormatter": "dbaeumer.vscode-eslint"` and set `"eslint.format.enable": true`. The Prettier formatter reads project config, overrides, EditorConfig and the nearest installed Prettier/plugins. Unknown formatter IDs report that they are unavailable. These IDs select Tributary’s native integrations; they do not install or run the complete VS Code extension host. `.code-workspace` settings remain preserved but are not applied.

Malformed settings, missing tools and failed automatic actions produce an actionable message and preserve the text for ordinary saving. Manual formatting/fixes report failures. Plain saves and ESLint-only fixes preserve existing LF/CRLF; a successful document formatter can apply its configured line ending. File modification checks still protect newer on-disk changes.

## Process and validation boundaries

Declarative inspection does not import project JavaScript. Actual linting requires project trust and runs the project’s library/config/plugins in an owned child process, not a security sandbox. The bridge accepts text up to 1 MiB, queues at most 16 checks per project, keeps at most two lint processes and 128 editor leases, bounds output/diagnostics, and times out checks after 15 seconds. Typing checks coalesce; closing/hiding the final lint editor releases its process. No transcript or document-history cache is added by ESLint.

Source patterns were reviewed in [VS Code’s text file working-copy model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/textfile/common/textFileEditorModel.ts), [the ESLint extension client](https://github.com/microsoft/vscode-eslint/blob/main/client/src/client.ts), [server](https://github.com/microsoft/vscode-eslint/blob/main/server/src/eslint.ts) and [settings guide](https://github.com/microsoft/vscode-eslint/blob/main/README.md). Tributary implements this scoped behavior through its own hub/editor; it does not claim complete VS Code settings compatibility.

Tests include process ownership/late replies, queue coalescing, config reload, output bounds, save/fix separation, async file reads, and monorepo Prettier/plugins. Real engine checks exercised ESLint **9.39.5** and **10.14.0**; native Linux UI checks use **10.14.0** with **typescript-eslint 8.72.1**. Run the optional real-engine UI script with a disposable installed project:

```sh
TRIBUTARY_ESLINT_FIXTURE=/tmp/your-disposable-project \
  xvfb-run -a node_modules/.bin/electron test/e2e/eslint.cjs --ozone-platform=x11
```

The script restores its fixture files/settings on exit. It verifies diagnostics, right-click fixes, undo, a delayed real fix versus newer typing, save-only checks, changed config, multiple workspace folders and a narrow installation-preview panel. It does not execute the installation command or certify native macOS/Windows editor UI. The packaged distribution check separately verifies lint-worker transport using a class-API fixture, not a real ESLint rule engine.
