'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { execFileSync } = require('node:child_process'); const { mkdtemp } = require('./helpers/tmp');
const { ProjectFormatter, formatProjectSource } = require('../core/project-format');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const workspace = () => { const root = mkdtemp('format-project'); execFileSync('git', ['init', '-q', root]); return root; };
const formatter = () => new ProjectFormatter({ trusted: () => true, write: async (root, rel, text, mtime) => { assert.equal(fs.statSync(path.join(root, rel)).mtimeMs, mtime); fs.writeFileSync(path.join(root, rel), text); } });
test('formatting respects project configuration, overrides, EditorConfig and existing line endings', async () => {
  const root = workspace(); put(root, '.prettierrc.json', JSON.stringify({ singleQuote: true, semi: false, overrides: [{ files: '*.ts', options: { tabWidth: 4 } }] }));
  put(root, '.editorconfig', 'root = true\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = crlf\n');
  put(root, 'main.js', "const value = 'old'\r\n");
  const result = await formatProjectSource(root, 'main.js', 'const value="new";\n', true);
  assert.equal(result, "const value = 'new'\r\n");
  put(root, 'main.ts', 'function f(){return 1;}');
  assert.match(await formatProjectSource(root, 'main.ts', 'function f(){return 1;}', true), /\r\n {4}return 1\r\n/);
  put(root, '.prettierrc.json', '{bad'); await assert.rejects(formatProjectSource(root, 'main.js', 'const value=1;', true), /JSON|parse|expected/i);
});
test('without a style file, formatting retains existing quotes, semicolons, indentation and CRLF', async () => {
  const root = workspace(); put(root, 'source.js', "function f() {\r\n    const name = 'before'\r\n    return name\r\n}\r\n");
  const text = await formatProjectSource(root, 'source.js', 'function f(){const name="after";return name;}', true);
  assert.match(text, /\r\n {4}const name = 'after'\r\n/); assert.doesNotMatch(text, /;|(?<!\r)\n/);
  put(root, 'source.js', text); assert.equal(await formatProjectSource(root, 'source.js', text, true), text);
});
test('automatic formatting leaves unsupported files available to save', async () => {
  const root = workspace(); put(root, 'notes.unknown', 'original');
  assert.equal(await formatProjectSource(root, 'notes.unknown', 'unsaved text', true, true), 'unsaved text');
  await assert.rejects(formatProjectSource(root, 'notes.unknown', 'unsaved text', true), /formatter/);
  assert.equal(read(root, 'notes.unknown'), 'original');
});
test('a nested workspace folder inherits monorepo formatting and detects changed parent rules', async () => {
  const parent = workspace(); const root = path.join(parent, 'app'); fs.mkdirSync(root);
  put(parent, '.prettierrc.json', '{"singleQuote":true,"semi":false}'); put(root, 'main.js', 'const value="hello";');
  assert.equal(await formatProjectSource(root, 'main.js', 'const value="hello";', true), "const value = 'hello'\n");
  const fmt = formatter(); const preview = await fmt.preview(root); put(parent, '.prettierrc.json', '{"semi":true}');
  await assert.rejects(fmt.apply(root, preview.token, ['main.js']), /rules changed/); assert.equal(read(root, 'main.js'), 'const value="hello";');
});
test('format-all preview skips unsaved, ignored and generated files and does not rewrite unchanged files', async () => {
  const root = workspace(); put(root, '.prettierrc.json', '{"singleQuote":true,"semi":true}');
  put(root, '.prettierignore', 'ignored.js\n'); put(root, '.gitignore', 'gitignored.js\n');
  put(root, 'good.js', "const value = 'good';\n"); put(root, 'dense.js', 'try{run();}catch{stop();}'); put(root, 'unsaved.js', 'const a=1;');
  put(root, 'ignored.js', 'const a=1;'); put(root, 'gitignored.js', 'const a=1;'); put(root, 'dist/generated.js', 'const a=1;'); put(root, 'marked.js', '// DO NOT EDIT\nconst a=1;');
  const fmt = formatter(); const mtime = fs.statSync(path.join(root, 'good.js')).mtimeMs;
  const preview = await fmt.preview(root, ['unsaved.js']); const status = (name) => preview.rows.find((row) => row.rel === name)?.status;
  assert.equal(status('good.js'), 'unchanged'); assert.equal(status('dense.js'), 'changed'); assert.equal(status('unsaved.js'), 'unsaved'); assert.equal(status('ignored.js'), 'ignored'); assert.equal(status('marked.js'), 'skipped'); assert.equal(status('dist/generated.js'), undefined); assert.equal(status('gitignored.js'), undefined);
  assert.equal(read(root, 'dense.js'), 'try{run();}catch{stop();}'); assert.match(fmt.diff(root, preview.token, 'dense.js'), /\+try \{/);
  const applied = await fmt.apply(root, preview.token, preview.rows.filter((row) => row.status === 'changed').map((row) => row.rel)); assert.equal(applied.rows[0].status, 'formatted');
  assert.equal(fs.statSync(path.join(root, 'good.js')).mtimeMs, mtime); assert.equal(read(root, 'ignored.js'), 'const a=1;');
  const second = await fmt.preview(root, ['unsaved.js']); assert.equal(second.rows.filter((row) => row.status === 'changed').length, 0);
  const clean = (await fmt.preview(root, ['unsaved.js'])).rows.find((row) => row.rel === 'dense.js'); assert.equal(clean.status, 'unchanged');
});
test('format-all refuses newer edits and changed rules; undo never overwrites newer work', async () => {
  const root = workspace(); put(root, '.prettierrc.json', '{}'); put(root, 'a.js', 'const a=1;'); put(root, 'b.js', 'const b=2;');
  const fmt = formatter(); let preview = await fmt.preview(root);
  put(root, '.prettierrc.json', '{"semi":false}'); await assert.rejects(fmt.apply(root, preview.token, ['a.js']), /rules changed/); assert.equal(read(root, 'a.js'), 'const a=1;');
  preview = await fmt.preview(root); put(root, 'a.js', 'newer edit');
  const applied = await fmt.apply(root, preview.token, ['a.js', 'b.js']); assert.equal(applied.rows[0].status, 'conflict'); assert.equal(applied.rows[1].status, 'formatted');
  const blocked = await fmt.apply(root, preview.token, ['b.js'], ['b.js'], true); assert.equal(blocked.rows[0].status, 'conflict');
  const undone = await fmt.apply(root, preview.token, ['b.js'], [], true); assert.equal(undone.rows[0].status, 'restored'); assert.equal(read(root, 'b.js'), 'const b=2;');
  preview = await fmt.preview(root); await fmt.apply(root, preview.token, ['b.js']); put(root, 'b.js', 'newer background edit');
  assert.equal((await fmt.apply(root, preview.token, ['b.js'], [], true)).rows[0].status, 'conflict'); assert.equal(read(root, 'b.js'), 'newer background edit');
});
test('project formatter uses a project-local runtime, and untrusted config cannot execute', async () => {
  const root = workspace(); put(root, 'main.js', 'const x=1;');
  put(root, 'prettier.config.cjs', "require('fs').writeFileSync(require('path').join(__dirname,'executed'), 'yes'); module.exports = { singleQuote: true }; ");
  await assert.rejects(formatProjectSource(root, 'main.js', 'const x=1;', false), /Trust this project/); assert.equal(fs.existsSync(path.join(root, 'executed')), false);
  await formatProjectSource(root, 'main.js', 'const x=1;', true); assert.equal(read(root, 'executed'), 'yes');
  put(root, 'node_modules/prettier/package.json', '{"name":"prettier","main":"index.cjs"}');
  put(root, 'node_modules/prettier/index.cjs', `const p = require(${JSON.stringify(require.resolve('prettier'))}); module.exports = { ...p, format: async (...args) => (await p.format(...args)) + '// local runtime\\n' };`);
  assert.match(await formatProjectSource(root, 'main.js', 'const x=1;', true), /local runtime/);
});
test('multiple workspace folders allow editing, keep idempotent saves clean, and can be removed', async () => {
  const root = workspace(); const extra = workspace(); const other = workspace(); const hub = await new Hub({ dataDir: mkdtemp('format-store'), home: mkdtemp('format-home'), secrets: new MemorySecrets() }).init();
  hub.addProject(root); hub.setProjectFolders(root, [extra, other, extra]); assert.deepEqual(hub.project(root).folders, [extra, other]);
  assert.ok(hub.isWorkspace(extra)); assert.ok(hub.qaTrusted(extra)); put(extra, 'a.js', "const a = 'value';\n");
  const before = fs.statSync(path.join(extra, 'a.js')).mtimeMs; await hub.writeFile(extra, 'a.js', read(extra, 'a.js'), before); assert.equal(fs.statSync(path.join(extra, 'a.js')).mtimeMs, before);
  await hub.writeFile(extra, 'a.js', 'const a = 2;\n', before); assert.equal((await hub.readFile(extra, 'a.js')).content, 'const a = 2;\n');
  assert.ok((await hub.listFiles(extra)).includes('a.js')); hub.setProjectFolders(root, [other]); assert.equal(hub.isWorkspace(extra), false); await assert.rejects(hub.readFile(extra, 'a.js'), /Unknown project/);
  assert.throws(() => hub.setProjectFolders(root, ['relative']), /absolute/); assert.throws(() => hub.setProjectFolders(root, Array(33).fill(other)), /32/);
});
test('VS Code workspace files round trip relative folders and preserve comments, aliases and settings', async () => {
  const { parseWorkspace, serializeWorkspace } = require('../core/workspace-file');
  const root = workspace(); const first = path.join(root, 'app'); const second = path.join(root, 'api'); fs.mkdirSync(first); fs.mkdirSync(second);
  const filename = path.join(root, 'team.code-workspace');
  const source = '// keep this comment\r\n{\r\n\t"folders": [{"path":"app","name":"Frontend"}],\r\n\t"settings": {"editor.tabSize": 4},\r\n}\r\n';
  const text = serializeWorkspace(filename, [first, second], source);
  assert.match(text, /^\/\/ keep this comment/); assert.match(text, /"Frontend"/); assert.match(text, /"editor.tabSize": 4/); assert.ok(text.includes('\r\n'));
  assert.deepEqual(parseWorkspace(filename, text), [first, second]); assert.equal(serializeWorkspace(filename, [first, second], text), text);
  assert.throws(() => parseWorkspace(filename, '{"folders":[{"uri":"vscode-remote://host/folder"}]}'), /non-local/);
  assert.throws(() => serializeWorkspace(filename, [first], '{bad'), /not overwritten/);
  const hub = await new Hub({ dataDir: mkdtemp('workspace-store'), home: mkdtemp('workspace-home'), secrets: new MemorySecrets() }).init();
  fs.writeFileSync(filename, text); assert.equal(hub.importWorkspace(filename), first); assert.deepEqual(hub.project(first).folders, [second]);
  const mtime = fs.statSync(filename).mtimeMs; hub.exportWorkspace(first, filename); assert.equal(fs.statSync(filename).mtimeMs, mtime); assert.equal(read(root, 'team.code-workspace'), text);
});
