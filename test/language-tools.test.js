'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const { once, EventEmitter } = require('node:events');
const { LanguageTools, configurations } = require('../core/language-tools'); const { mkdtemp } = require('./helpers/tmp');
test('shell, Lua and TOML formatters receive drafts over stdin without changing files', { skip: process.platform === 'win32' }, async () => {
  const { formatSource } = require('../core/format-source'); const root = mkdtemp('native-format');
  const binary = path.join(root, 'tools'); fs.mkdirSync(binary);
  const script = `#!${process.execPath}\nlet text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({args:process.argv.slice(2),text,cwd:process.cwd()})));\n`;
  for (const name of ['shfmt', 'stylua', 'taplo']) { fs.writeFileSync(path.join(binary, name), script, { mode: 0o700 }); }
  for (const [rel, args] of [['space ; file.sh', ['-filename', path.join(root, 'space ; file.sh')]], ['main.lua', ['--stdin-filepath', path.join(root, 'main.lua'), '-']], ['Cargo.toml', ['format', '-']]]) {
    const file = path.join(root, rel); fs.writeFileSync(file, 'original'); const text = 'unsaved draft';
    const result = JSON.parse(await formatSource(root, rel, text, { env: { ...process.env, PATH: binary } }));
    assert.deepEqual(result.args, args); assert.equal(result.text, text); assert.equal(result.cwd, root); assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  }
  await assert.rejects(formatSource(root, 'main.lua', 'draft', { env: { ...process.env, PATH: '' } }), /Install stylua/);
  fs.writeFileSync(path.join(binary, 'stylua'), `#!${process.execPath}\nprocess.stderr.write('Invalid Lua');process.exit(1);`, { mode: 0o700 });
  await assert.rejects(formatSource(root, 'main.lua', 'draft', { env: { ...process.env, PATH: binary } }), /Invalid Lua/);
  const { nativeFormatTool } = await import('../ui/src/lib/format-document.mjs');
  assert.equal(nativeFormatTool('main.sh'), 'shfmt'); assert.equal(nativeFormatTool('main.lua'), 'StyLua'); assert.equal(nativeFormatTool('Cargo.toml'), 'Taplo');
  const tools = new LanguageTools({ getConfig: () => [], trusted: () => false, publish: () => {} });
  for (const id of ['prettier', 'black', 'shfmt', 'stylua', 'taplo']) assert.ok(tools.catalog().formatters.find((row) => row.id === id)?.docs, id);
});
test('configured language servers supply real diagnostics, completions and explicit draft formatting', async (t) => {
  const root = mkdtemp('language-server'); const file = path.join(root, 'main.ts'); fs.writeFileSync(file, 'const value=1;\n');
  const events = new EventEmitter(); const tools = new LanguageTools({ getConfig: () => [{ id: 'typescript', command: process.execPath, args: [path.join(__dirname, 'fake-language-server.cjs')], enabled: true }], trusted: () => true, publish: (event) => events.emit('diagnostics', event) }); t.after(() => tools.stopAll());
  const next = once(events, 'diagnostics', { signal: AbortSignal.timeout(5000) });
  const state = await tools.open(root, 'main.ts', 'BAD const value=1;\n'); assert.equal(state.active, true);
  const [event] = await next; assert.equal(event.project, root); assert.equal(event.diagnostics[0].message, 'Fixture server found BAD'); assert.equal(event.text, 'BAD const value=1;\n');
  const items = await tools.complete(root, 'main.ts', 'const value=1;\n', { line: 0, character: 5 }); assert.equal(items[0].label, 'fixtureCompletion');
  const edits = await tools.format(root, 'main.ts', 'const value=1;\n', { tabSize: 2, insertSpaces: true });
  const { applyLspEdits } = await import('../ui/src/lib/lsp-edits.mjs'); assert.equal(applyLspEdits('const value=1;\n', edits), 'const value = 1;\n'); assert.equal(fs.readFileSync(file, 'utf8'), 'const value=1;\n');
  tools.closeDocument(root, 'main.ts'); assert.equal(tools.sessions.size, 0);
});
test('disabled and untrusted language servers do not spawn, and escaped paths are rejected', async (t) => {
  const root = mkdtemp('language-trust'); fs.writeFileSync(path.join(root, 'a.ts'), 'x');
  const tools = new LanguageTools({ getConfig: () => [{ id: 'typescript', command: process.execPath, args: [], enabled: true }], trusted: () => false, publish: () => {} }); t.after(() => tools.stopAll());
  await assert.rejects(tools.open(root, 'a.ts', 'x'), /Trust this project/); assert.equal(tools.sessions.size, 0);
  await assert.rejects(tools.open(root, '../private.ts', 'x'), /outside project/);
  tools.getConfig = () => []; assert.equal((await tools.open(root, 'a.ts', 'x')).active, false);
  assert.throws(() => configurations([{ id: 'typescript', command: 'node', args: 'shell script' }]), /JSON array/);
});
test('formatter edits use UTF-16 positions and reject invalid or overlapping ranges', async () => {
  const { applyLspEdits } = await import('../ui/src/lib/lsp-edits.mjs');
  const edit = (a, b, newText) => ({ range: { start: { line: 0, character: a }, end: { line: 0, character: b } }, newText });
  assert.equal(applyLspEdits('😀x', [edit(2, 3, 'y')]), '😀y'); assert.throws(() => applyLspEdits('abc', [edit(0, 2, ''), edit(1, 3, '')]), /Overlapping/); assert.throws(() => applyLspEdits('abc', [edit(4, 5, '')]), /Invalid/);
});

test('closing a document during server initialization does not leave a background process', async (t) => {
  const root = mkdtemp('language-close'); fs.writeFileSync(path.join(root, 'a.ts'), 'x');
  const tools = new LanguageTools({ getConfig: () => [{ id: 'typescript', command: process.execPath, args: [path.join(__dirname, 'fake-language-server.cjs')], enabled: true }], trusted: () => true, publish: () => {} }); t.after(() => tools.stopAll());
  const pending = tools.open(root, 'a.ts', 'x').catch((error) => error);
  tools.closeDocument(root, 'a.ts');
  const result = await pending; assert.ok(result instanceof Error); assert.equal(tools.sessions.size, 0);
});

test('navigation keeps real project locations, deduplicates results and blocks external files and symlinks', async (t) => {
  const base = mkdtemp('language-navigation'); const root = path.join(base, 'project'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'main.ts'), 'const value=1;'); fs.writeFileSync(path.join(root, 'helper.ts'), '😀x'); fs.writeFileSync(path.join(base, 'outside.ts'), 'private');
  fs.symlinkSync(path.join(base, 'outside.ts'), path.join(root, 'linked.ts'));
  const tools = new LanguageTools({ getConfig: () => [{ id: 'typescript', command: process.execPath, args: [path.join(__dirname, 'fake-language-server.cjs')], enabled: true }], trusted: () => true, publish() {} });
  t.after(() => { tools.stopAll(); fs.rmSync(base, { recursive: true, force: true }); });
  const result = await tools.locations(root, 'main.ts', 'const draft=2;', { line: 0, character: 6 }, 'definition');
  assert.equal(result.supported, true); assert.deepEqual(result.locations, [{ rel: 'main.ts', line: 1, column: 3 }, { rel: 'helper.ts', line: 1, column: 3 }]); assert.equal(result.omitted, 3);
  const type = await tools.locations(root, 'main.ts', 'const draft=2;', { line: 0, character: 6 }, 'typeDefinition'); assert.equal(type.locations[0].column, 3);
  const refs = await tools.locations(root, 'main.ts', 'const draft=2;', { line: 0, character: 6 }, 'references'); assert.equal(refs.locations.length, 1);
  const alias = path.join(base, 'project-alias'); fs.symlinkSync(root, alias);
  const aliased = await tools.locations(alias, 'main.ts', 'const draft=2;', { line: 0, character: 6 }, 'definition'); assert.deepEqual(aliased.locations, result.locations); assert.equal(aliased.omitted, 3);
  assert.equal((await tools.locations(root, 'main.ts', 'x', { line: 0, character: 0 }, 'implementation')).supported, false);
  await assert.rejects(tools.locations(root, 'main.ts', 'x', { line: -1, character: 0 }, 'definition'), /Invalid navigation/);
  await assert.rejects(tools.locations(root, 'main.ts', 'x', { line: 0, character: 0 }, 'rename'), /Invalid navigation/);
  assert.equal(fs.readFileSync(path.join(root, 'main.ts'), 'utf8'), 'const value=1;');
  tools.stopAll(); tools.getConfig = () => [];
  assert.equal((await tools.locations(root, 'main.ts', 'x', { line: 0, character: 0 }, 'definition')).supported, false); assert.equal(tools.sessions.size, 0);
});
