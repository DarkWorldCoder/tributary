'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { editorSettings, editorToolSetup } = require('../core/editor-settings');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-editor-settings-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, value) => { const full = path.join(root, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); };
  write('package.json', JSON.stringify({ name: 'fixture', packageManager: 'pnpm@10.0.0' })); write('src/main.ts', 'export const value = 1;\n');
  return { root, write };
}
test('workspace JSONC and language scopes control formatting and ESLint independently without executing config', async t => {
  const { root, write } = fixture(t);
  write('.vscode/settings.json', `{// Comments and trailing commas are accepted.\n"editor.formatOnSave":true,"editor.defaultFormatter":"esbenp.prettier-vscode","editor.codeActionsOnSave":{"source.fixAll":true},"eslint.validate":["typescript"],"[typescript][typescriptreact]":{"editor.formatOnSave":false,"editor.codeActionsOnSave":{"source.fixAll.eslint":false}},}`);
  write('eslint.config.mjs', 'throw Error("Do not execute configuration during inspection");');
  const config = await editorSettings(root, 'src/main.ts');
  assert.equal(config.formatOnSave, false); assert.equal(config.defaultFormatter, 'esbenp.prettier-vscode'); assert.equal(config.eslint.enabled, true); assert.equal(config.eslint.fixOnSave, false);
  write('main.js', 'let value = 1;'); assert.equal((await editorSettings(root, 'main.js')).eslint.enabled, false);
  write('.vscode/settings.json', '{"[typescript]":{"editor.formatOnSave":true},"editor.codeActionsOnSave":{"source.fixAll.eslint":"explicit"}}');
  const changed = await editorSettings(root, 'src/main.ts'); assert.equal(changed.formatOnSave, true); assert.equal(changed.eslint.fixOnSave, true, 'new rules are read on the next request');
});
test('monorepo working directories use the closest match and inspect the local ESLint library without importing it', async t => {
  const { root, write } = fixture(t);
  write('packages/app/src/main.ts', 'export const value = 1;');
  write('packages/app/eslint.config.mjs', 'throw Error("Must not execute");');
  write('packages/app/node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', version: '9.99.0', main: 'lib/api.cjs' }));
  write('packages/app/node_modules/eslint/lib/api.cjs', 'throw Error("Must not import");');
  write('.vscode/settings.json', '{"eslint.workingDirectories":[{"pattern":"./packages/*/"},{"directory":"./packages/app","!cwd":true}]}');
  const config = await editorSettings(root, 'packages/app/src/main.ts');
  assert.equal(config.eslint.cwd, path.join(root, 'packages/app')); assert.equal(config.eslint.version, '9.99.0'); assert.ok(config.eslint.library.endsWith('api.cjs'));
  // Equal-specificity entries retain the first match, like the extension.
  assert.equal(config.eslint.changeProcessCwd, true);
  write('.vscode/settings.json', '{"eslint.workingDirectories":[{"directory":"./packages/app","!cwd":true}]}');
  assert.equal((await editorSettings(root, 'packages/app/src/main.ts')).eslint.changeProcessCwd, false);
  write('.vscode/settings.json', '{}'); assert.equal((await editorSettings(root, 'packages/app/src/main.ts')).eslint.cwd, path.join(root, 'packages/app'));
});
test('tool setup follows the declared package manager and does not install or rewrite files', async t => {
  const { root, write } = fixture(t); write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8'); const setup = await editorToolSetup(root);
  assert.equal(setup.manager, 'pnpm'); assert.equal(setup.install, 'pnpm add --save-dev --workspace-root eslint'); assert.equal(setup.eslint.library, null);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before); assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  write('package.json', '{"name":"fixture","packageManager":"yarn@4.0.0"}'); assert.equal((await editorToolSetup(root)).install, 'yarn add --dev eslint');
});
test('malformed, oversized and outside-workspace configuration is reported instead of silently applying defaults', async t => {
  const { root, write } = fixture(t);
  write('.vscode/settings.json', '{broken'); await assert.rejects(editorSettings(root, 'src/main.ts'), /JSON syntax/);
  write('.vscode/settings.json', ' '.repeat(256 * 1024 + 1)); await assert.rejects(editorSettings(root, 'src/main.ts'), /256 KB/);
  write('.vscode/settings.json', '{"eslint.workingDirectories":["../"]}'); await assert.rejects(editorSettings(root, 'src/main.ts'), /inside the workspace/);
  write('.vscode/settings.json', '{"eslint.workingDirectories":[{"pattern":"../*"}]}'); await assert.rejects(editorSettings(root, 'src/main.ts'), /inside the workspace/);
  write('.vscode/settings.json', '{}'); await assert.rejects(editorSettings(root, '../outside.js'), /outside project/);
});
