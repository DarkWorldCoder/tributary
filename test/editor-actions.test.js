'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { editorAction } = require('../core/editor-actions'); const { eslintFixture } = require('./helpers/eslint-fixture');
const never = async () => { throw Error('Unexpected ESLint execution'); };
test('project format-on-save overrides the app default; fixes run independently and only once', async t => {
  const { root, put } = eslintFixture(t); let fixes = 0; const fix = async text => { fixes++; return { output: text.replace('var', 'let') }; };
  put('.vscode/settings.json', '{"editor.formatOnSave":false,"editor.codeActionsOnSave":{"source.fixAll.eslint":"explicit"}}');
  assert.equal((await editorAction(root, 'sample.js', 'var x=1;', { automatic: true, trusted: true, fix })).text, 'let x=1;'); assert.equal(fixes, 1);
  put('.vscode/settings.json', '{"editor.formatOnSave":true}');
  assert.equal((await editorAction(root, 'sample.js', 'var x=1;', { automatic: true, formatOnSave: false, trusted: true, fix: never })).text, 'var x = 1;\n');
  put('.vscode/settings.json', '{"editor.defaultFormatter":"dbaeumer.vscode-eslint","eslint.format.enable":true,"editor.codeActionsOnSave":{"source.fixAll.eslint":true}}');
  assert.equal((await editorAction(root, 'sample.js', 'var x=1;', { automatic: true, trusted: true, fix })).text, 'let x=1;'); assert.equal(fixes, 2);
});
test('save failures preserve the draft and disk line endings, while manual failures remain actionable', async t => {
  const { root, put } = eslintFixture(t); put('sample.js', 'var x=1;\r\n');
  put('.vscode/settings.json', '{broken');
  const malformed = await editorAction(root, 'sample.js', 'var x=2;\n', { automatic: true, trusted: true, fix: never }); assert.equal(malformed.text, 'var x=2;\r\n'); assert.match(malformed.warnings[0], /JSON syntax/);
  await assert.rejects(editorAction(root, 'sample.js', 'draft', { trusted: true, fix: never }), /JSON syntax/);
  put('.vscode/settings.json', '{"editor.defaultFormatter":"dbaeumer.vscode-eslint"}');
  await assert.rejects(editorAction(root, 'sample.js', 'draft', { trusted: true, fix: never }), /eslint.format.enable/);
  put('.vscode/settings.json', '{"editor.formatOnSave":false,"editor.codeActionsOnSave":{"source.fixAll.eslint":true}}');
  const failed = await editorAction(root, 'sample.js', 'var x=3;\n', { automatic: true, trusted: true, fix: async () => { throw Error('plugin failed'); } });
  assert.equal(failed.text, 'var x=3;\r\n'); assert.deepEqual(failed.warnings, ['plugin failed']); assert.equal(fs.readFileSync(path.join(root, 'sample.js'), 'utf8'), 'var x=1;\r\n');
});
test('untrusted automatic saves do not import tools; ignored and unsupported saves retain original EOL', async t => {
  const { root, put } = eslintFixture(t); put('sample.js', 'var x=1;\r\n'); put('.prettierignore', 'sample.js\n');
  put('.vscode/settings.json', '{"editor.codeActionsOnSave":{"source.fixAll.eslint":true}}');
  assert.equal((await editorAction(root, 'sample.js', 'var x=2;\n', { automatic: true, trusted: false, fix: never })).text, 'var x=2;\r\n');
  assert.equal(fs.existsSync(path.join(root, 'node_modules/eslint/loaded')), false);
  put('.vscode/settings.json', '{}'); assert.equal((await editorAction(root, 'sample.js', 'var x=2;\n', { automatic: true, trusted: true, fix: never })).text, 'var x=2;\r\n');
  put('notes.unknown', 'old\r\n'); assert.equal((await editorAction(root, 'notes.unknown', 'new\n', { automatic: true, trusted: true, fix: never })).text, 'new\r\n');
  put('.vscode/settings.json', '{"editor.defaultFormatter":"missing.extension"}');
  await assert.rejects(editorAction(root, 'sample.js', 'draft', { trusted: true, fix: never }), /selected formatter/);
});
