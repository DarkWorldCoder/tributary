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
test('formatting previews release expired source revisions without another formatter call', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const root = workspace(); put(root, 'main.js', 'const value=1;');
  const fmt = formatter(); const preview = await fmt.preview(root);
  assert.equal(fmt.plans.size, 1); assert.match(fmt.diff(root, preview.token, 'main.js'), /\+const value = 1;/);
  t.mock.timers.tick(600000);
  // Preserve the existing inclusive ten-minute validity boundary. Reading the
  // diff does not renew a preview's lifetime or shorten its undo window.
  assert.match(fmt.diff(root, preview.token, 'main.js'), /\+const value = 1;/);
  t.mock.timers.tick(1);
  assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null);
  assert.throws(() => fmt.diff(root, preview.token, 'main.js'), /expired/);
  assert.equal(read(root, 'main.js'), 'const value=1;');
});
test('expiring one formatting project preserves the other project and its undo', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const first = workspace(); const second = workspace();
  put(first, 'main.js', 'const first=1;'); put(second, 'main.js', 'const second=2;');
  const fmt = formatter(); const one = await fmt.preview(first);
  t.mock.timers.tick(1000); const two = await fmt.preview(second);
  await fmt.apply(second, two.token, ['main.js']); assert.match(read(second, 'main.js'), /const second = 2;/);
  t.mock.timers.tick(599001);
  assert.equal(fmt.plans.size, 1); assert.throws(() => fmt.diff(first, one.token, 'main.js'), /expired/);
  assert.equal((await fmt.apply(second, two.token, ['main.js'], [], true)).rows[0].status, 'restored');
  assert.equal(read(second, 'main.js'), 'const second=2;');
  t.mock.timers.tick(1000); assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null);
});
test('replacement and capacity eviction do not let an old expiry delete a newer preview', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const roots = Array.from({ length: 3 }, () => { const root = workspace(); put(root, 'main.js', 'const value=1;'); return root; });
  const fmt = formatter(); const old = await fmt.preview(roots[0]);
  t.mock.timers.tick(1000); const replacement = await fmt.preview(roots[0]);
  assert.throws(() => fmt.diff(roots[0], old.token, 'main.js'), /expired/);
  t.mock.timers.tick(1000); await fmt.preview(roots[1]);
  t.mock.timers.tick(598001); assert.match(fmt.diff(roots[0], replacement.token, 'main.js'), /\+const value = 1;/);
  const third = await fmt.preview(roots[2]);
  assert.equal(fmt.plans.size, 2); assert.throws(() => fmt.diff(roots[0], replacement.token, 'main.js'), /expired/);
  t.mock.timers.tick(2000); assert.equal(fmt.plans.size, 1);
  assert.match(fmt.diff(roots[2], third.token, 'main.js'), /\+const value = 1;/);
  t.mock.timers.tick(598001); assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null);
});
test('an already admitted formatting write settles safely across preview expiry', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const root = workspace(); put(root, 'main.js', 'const value=1;');
  let begin, finish; const writing = new Promise(resolve => { begin = resolve; }); const gate = new Promise(resolve => { finish = resolve; });
  const fmt = new ProjectFormatter({ trusted: () => true, write: async (root, rel, text) => { begin(); await gate; put(root, rel, text); } });
  const preview = await fmt.preview(root); const applying = fmt.apply(root, preview.token, ['main.js']); await writing;
  t.mock.timers.tick(600001); assert.equal(fmt.plans.size, 0);
  finish(); assert.equal((await applying).rows[0].status, 'formatted');
  assert.match(read(root, 'main.js'), /const value = 1;/); assert.equal(fmt.plans.size, 0);
  await assert.rejects(fmt.apply(root, preview.token, ['main.js'], [], true), /expired/);
});
test('a formatting preview expiry timer does not keep a CLI process alive', () => {
  const root = workspace(); put(root, 'main.js', 'const value=1;');
  const script = `const {ProjectFormatter}=require(${JSON.stringify(require.resolve('../core/project-format'))});new ProjectFormatter({trusted:()=>true,write:async()=>{}}).preview(${JSON.stringify(root)}).then(result=>console.log(result.rows[0].status)).catch(error=>{console.error(error);process.exitCode=1;});`;
  assert.equal(execFileSync(process.execPath, ['-e', script], { timeout: 10000, encoding: 'utf8' }).trim(), 'changed');
});
test('closing the Hub store releases formatting previews and their expiry owner', async (t) => {
  const root = workspace(); put(root, 'main.js', 'const value=1;');
  const hub = new Hub({ dataDir: mkdtemp('format-close-data'), home: mkdtemp('format-close-home'), secrets: new MemorySecrets() });
  t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  hub.addProject(root); await hub.previewFormat(root);
  const fmt = hub.projectFormatter; assert.equal(fmt.plans.size, 1); assert.ok(fmt.timer); assert.equal(fmt.timer.hasRef(), false);
  hub.store.close(); hub.store.close();
  assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null);
  await assert.rejects(fmt.preview(root), /closed/);
});
test('JSON fallback store close also releases formatter cache ownership', async () => {
  const { Store } = require('../core/store'); const root = workspace(); put(root, 'main.js', 'const value=1;');
  const fmt = formatter(); await fmt.preview(root);
  const store = new Store(path.join(mkdtemp('format-json-data'), 'hub.json'), { threads: [] }); store.projectFormatter = fmt;
  store.close(); assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null); assert.equal(fmt.closed, true);
});
test('a preview completing after owner close cannot recreate the cache or expiry timer', async () => {
  const root = workspace(); put(root, 'main.js', 'const value=1;');
  const fmt = formatter(); const pending = fmt.preview(root); fmt.close();
  await assert.rejects(pending, /closed/); assert.equal(fmt.plans.size, 0); assert.equal(fmt.timer, null); assert.equal(fmt.busy.size, 0);
});
test('fallback JSX quote detection handles long source tokens and preserves attribute quote style', async () => {
  const root = workspace(); const comment = '// ' + 'A'.repeat(512 * 1024) + '\n';
  for (const [name, attribute, expected] of [['single', "data-long-name='hello'", "data-long-name='hello'"], ['double', 'xml:lang="hello"', 'xml:lang="hello"'], ['mixed', "data-name='hello' title=\"world\"", 'data-name="hello" title="world"']]) {
    const rel = name + '.jsx'; const text = comment + `const element=<div ${attribute}/>;\n`; put(root, rel, text);
    const formatted = await formatProjectSource(root, rel, text, true);
    assert.ok(formatted.startsWith(comment)); assert.ok(formatted.includes(expected)); assert.equal(read(root, rel), text);
  }
});
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
test('each monorepo package uses its nearest local Prettier in a shared formatting preview', async () => {
  const root = workspace();
  for (const [folder, marker] of [['.', 'root-runtime'], ['packages/app', 'package-runtime']]) {
    put(root, `${folder}/node_modules/prettier/package.json`, '{"name":"prettier","main":"index.cjs"}');
    put(root, `${folder}/node_modules/prettier/index.cjs`, `const p = require(${JSON.stringify(require.resolve('prettier'))}); module.exports = { ...p, format: async (...args) => (await p.format(...args)) + '// ${marker}\\n' };`);
  }
  put(root, 'root.js', 'const a=1;'); put(root, 'packages/app/main.js', 'const a=1;');
  const fmt = formatter(); const plan = await fmt.preview(root);
  assert.match(fmt.diff(root, plan.token, 'root.js'), /root-runtime/);
  assert.match(fmt.diff(root, plan.token, 'packages/app/main.js'), /package-runtime/);
  assert.doesNotMatch(fmt.diff(root, plan.token, 'packages/app/main.js'), /root-runtime/);
});
test('Prettier plugins resolve from the file package rather than the workspace root', async () => {
  const root = workspace(); put(root, 'packages/app/main.js', 'const value=1;');
  put(root, 'packages/app/.prettierrc.json', '{"plugins":["prettier-plugin-fixture"]}');
  put(root, 'packages/app/node_modules/prettier-plugin-fixture/package.json', '{"name":"prettier-plugin-fixture","main":"index.cjs"}');
  put(root, 'packages/app/node_modules/prettier-plugin-fixture/index.cjs', `const babel=require(${JSON.stringify(require.resolve('prettier/plugins/babel'))}); module.exports={parsers:{babel:{...babel.parsers.babel,preprocess:text=>text+'\\n// package plugin\\n'}}};`);
  assert.match(await formatProjectSource(root, 'packages/app/main.js', 'const value=1;', true), /package plugin/);
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
