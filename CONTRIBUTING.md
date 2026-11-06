# Contributing to Tributary

Start with an issue or a focused pull request that explains the user problem, the resulting behavior and how to check it. Preserve unrelated changes. The project is currently a preview; the [feature status](docs/FEATURE_STATUS.md) distinguishes shipped foundations from remaining work.

## Development

Use Node.js 24, npm and Git:

```sh
npm ci
npm ci --prefix ui
npm start
```

`npm run build:ui:clean` builds the frontend; `npm run dev -- /absolute/project/folder` opens it in the desktop app. Root dependencies include native terminal binaries. Source uses Electron, React/TypeScript, CodeMirror and a shared Node core; see [the layout](docs/GUIDE.md#layout).

## Before a pull request

```sh
npm test
npx --prefix ui tsc --noEmit -p ui/tsconfig.json
npm run build:ui:clean
git diff --check
```

`npm test` also builds the VS Code extension. Changes to desktop interactions should be checked in the actual app; a type check alone does not establish UI correctness. On Linux with Xvfb available:

```sh
xvfb-run -a node_modules/.bin/electron test/e2e/editor-split.cjs --ozone-platform=x11
xvfb-run -a node_modules/.bin/electron test/e2e/search-ui.cjs --ozone-platform=x11
xvfb-run -a node_modules/.bin/electron test/e2e/agent-editor.cjs --ozone-platform=x11
xvfb-run -a node_modules/.bin/electron test/e2e/formatting.cjs --ozone-platform=x11
xvfb-run -a node_modules/.bin/electron test/e2e/quick-open-focus.cjs --ozone-platform=x11
```

These native scripts use disposable profiles/files. Do not add `--smoke-test`: that mode exits early and does not run the full interaction checks. Native Windows/macOS and installer GUI testing remain separate.

For UI changes, attach real screenshots, including the file sidebar where relevant, and describe narrow-screen and keyboard behavior. For performance work, follow [the benchmark method](BENCHMARKS.md#add-a-result); avoid universal claims from synthetic fixtures.

## Keep changes reviewable

Use existing UI primitives, tokens and shortcuts. Keep unsaved buffers and undo history intact when hiding panels or navigating. Respect project formatting instead of reformatting unrelated files. Test provider-specific capabilities without implying every provider supports them.

Do not commit credentials, `.env` values, private project data or transcripts containing them. Use [the security reporting guidance](SECURITY.md) for sensitive findings.

## Releases

Each successful push to `main` is built as a versioned preview by [Distribution](.github/workflows/distribution.yml). Maintainers should read [release operations](docs/RELEASING.md), including retry and signing limits. Pull requests do not publish installers.

Contributions are provided under [MIT](LICENSE); keep third-party notices and licenses intact.
