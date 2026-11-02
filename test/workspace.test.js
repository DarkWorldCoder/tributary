'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
const test = require('node:test');
const assert = require('node:assert');
const { BUILTIN } = require('../core/agents');

const agent = (id) => BUILTIN.find((a) => a.id === id);
const base = { mode: 'edit', cwd: '/p', prompt: 'hi', extraDirs: ['/shared/lib', '/docs'] };

test('every agent gets the extra project folders through its own flag', () => {
  const claude = agent('claude').args(base);
  assert.deepStrictEqual(claude.slice(claude.indexOf('--add-dir'), claude.indexOf('--add-dir') + 3), ['--add-dir', '/shared/lib', '/docs']);
  const codex = agent('codex').args(base);
  assert.deepStrictEqual(codex.slice(codex.indexOf('--add-dir'), codex.indexOf('--add-dir') + 4), ['--add-dir', '/shared/lib', '--add-dir', '/docs']);
  const gem = agent('gemini').args(base);
  assert.deepStrictEqual(gem.slice(gem.indexOf('--include-directories'), gem.indexOf('--include-directories') + 2), ['--include-directories', '/shared/lib,/docs']);
  const agy = agent('antigravity').args(base);
  assert.deepStrictEqual(agy.filter((a, i, l) => a === '--add-dir' || l[i - 1] === '--add-dir'), ['--add-dir', '/shared/lib', '--add-dir', '/docs']);
});

test('no extra folders means no extra flags', () => {
  for (const id of ['claude', 'codex', 'gemini', 'antigravity']) {
    const args = agent(id).args({ ...base, extraDirs: [] }).join(' ');
    assert.doesNotMatch(args, /--add-dir|--include-directories/, id);
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-ws-'));

test('a project can include extra folders, and every turn passes them to the agent', async () => {
  const proj = tmp(); const lib = tmp(); const docs = tmp();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  const seen = [];
  hub.agents = [{ id: 'x', name: 'X', protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true,
    args: (o) => { seen.push(o.extraDirs); return [path.join(__dirname, 'fake-agent.js'), 'codex-exec']; } }];
  hub.addProject(proj);
  hub.setProjectFolders(proj, [lib, docs, lib]);
  assert.deepStrictEqual(hub.state().projects.find((p) => p.path === proj).folders, [lib, docs]);
  const t = hub.createThread(proj);
  await hub.send({ threadId: t.id, agentId: 'x', text: 'go' });
  assert.deepStrictEqual(seen, [[lib, docs]]);
  assert.throws(() => hub.setProjectFolders(proj, [path.join(lib, 'missing')]), /Not a folder/);
});

const { detectEditors, editorArgs } = require('../core/editors');

test('editors: open a file at a line with each editor’s own syntax', () => {
  assert.deepStrictEqual(editorArgs('vscode', { path: '/p/a.ts', line: 12 }), ['-g', '/p/a.ts:12']);
  assert.deepStrictEqual(editorArgs('cursor', { path: '/p/a.ts', line: 12 }), ['-g', '/p/a.ts:12']);
  assert.deepStrictEqual(editorArgs('zed', { path: '/p/a.ts', line: 12 }), ['/p/a.ts:12']);
  assert.deepStrictEqual(editorArgs('idea', { path: '/p/a.ts', line: 12 }), ['--line', '12', '/p/a.ts']);
  assert.deepStrictEqual(editorArgs('vscode', { path: '/p' }), ['/p']);
  assert.throws(() => editorArgs('notepad', { path: '/p' }), /Unknown editor/);
});

test('editors: detects only the editors installed on PATH', () => {
  const bin = tmp();
  for (const b of ['code', 'zed']) { fs.writeFileSync(path.join(bin, b), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, b), 0o755); }
  fs.writeFileSync(path.join(bin, 'cursor'), 'not executable');
  const found = detectEditors({ PATH: bin }, { extraDirs: [] });
  assert.deepStrictEqual(found.map((e) => e.id).sort(), ['vscode', 'zed']);
  assert.strictEqual(found.find((e) => e.id === 'zed').path, path.join(bin, 'zed'));
});

const { TerminalManager } = require('../core/terminal');

test('terminal: runs a real shell, streams output, accepts input, reports exit', async () => {
  const tm = new TerminalManager();
  const out = []; let exit = null;
  tm.on('data', ({ id, data }) => out.push([id, data]));
  const done = new Promise((r) => tm.on('exit', (e) => { exit = e; r(); }));
  const id = tm.create({ cwd: os.tmpdir(), cols: 80, rows: 24, shell: '/bin/sh', args: [] });
  tm.write(id, 'echo "hello-$((40+2))"\n');
  tm.write(id, 'exit 3\n');
  await done;
  const text = out.filter(([i]) => i === id).map(([, d]) => d).join('');
  assert.match(text, /hello-42/);
  assert.deepStrictEqual(exit, { id, code: 3 });
  assert.deepStrictEqual(tm.list(), []);
});

test('terminal: kill ends a running process and resize is accepted', async () => {
  const tm = new TerminalManager();
  const done = new Promise((r) => tm.on('exit', r));
  const id = tm.create({ cwd: os.tmpdir(), shell: '/bin/sh', args: ['-c', 'sleep 30'] });
  tm.resize(id, 120, 40);
  assert.deepStrictEqual(tm.list().map((t) => t.id), [id]);
  tm.kill(id);
  const e = await done;
  assert.strictEqual(e.id, id);
  assert.throws(() => tm.write('nope', 'x'), /No terminal/);
});

test('writeFile saves edits, refuses stale saves, and stays inside the project', async () => {
  const proj = tmp();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.addProject(proj);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v1');
  const opened = await hub.readFile(proj, 'a.txt');
  const saved = await hub.writeFile(proj, 'a.txt', 'v2 from editor', opened.mtime);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v2 from editor');
  assert.ok(saved.mtime >= opened.mtime);
  // An agent changes the file after the editor opened it.
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(proj, 'a.txt'), 'agent edit');
  await assert.rejects(hub.writeFile(proj, 'a.txt', 'stale editor text', saved.mtime), /changed on disk/);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'agent edit');
  // New files are allowed; paths outside the project are not.
  await hub.writeFile(proj, 'src/new.ts', 'export {}', null);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'src', 'new.ts'), 'utf8'), 'export {}');
  await assert.rejects(hub.writeFile(proj, '../escape.txt', 'x', null), /outside/);
});
