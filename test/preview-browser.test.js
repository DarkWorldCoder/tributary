'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkdtemp } = require('./helpers/tmp');
const { PreviewServers, previewCommand, previewUrl } = require('../core/preview-server');
const waitFor = async (fn) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 6000) throw new Error('Timed out'); await new Promise((resolve) => setTimeout(resolve, 25)); } };

test('preview history is per tab, removes forward history and refuses non-local addresses', async () => {
  const { newPreviewTab, navigatePreview, movePreview, previewAddress, previewTitle } = await import('../ui/src/lib/preview-tabs.mjs');
  let one = newPreviewTab('one'); const two = newPreviewTab('two', 'localhost:4000');
  one = navigatePreview(one, 'localhost:3000'); one = navigatePreview(one, 'localhost:3000/settings');
  one = movePreview(one, -1); assert.equal(previewAddress(one), 'http://localhost:3000/');
  one = navigatePreview(one, 'localhost:3000/about'); assert.equal(one.history.length, 2); assert.equal(previewTitle(one), 'localhost:3000/about');
  assert.equal(previewAddress(two), 'http://localhost:4000/'); assert.equal(navigatePreview(one, 'https://example.com'), null);
  assert.equal(navigatePreview(one, 'http://user:secret@localhost:3000'), null);
  assert.equal(previewTitle(movePreview(newPreviewTab('blank'), -1)), 'New tab');
  for (let i = 0; i < 70; i++) one = navigatePreview(one, `localhost:3000/${i}`);
  assert.equal(one.history.length, 50); assert.equal(one.index, 49);
});

test('preview launch discovers only declared dev/start scripts and rejects external manifest links', async (t) => {
  const root = mkdtemp('preview-manifest'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'not-a-preview' } })); assert.equal(await previewCommand(root), null);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  assert.equal((await previewCommand(root)).command, 'npm run dev');
  const external = mkdtemp('preview-external'); t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'package.json'), JSON.stringify({ scripts: { dev: 'external' } })); fs.unlinkSync(path.join(root, 'package.json'));
  fs.symlinkSync(path.join(external, 'package.json'), path.join(root, 'package.json')); assert.equal(await previewCommand(root), null);
  for (const address of ['file:///etc/passwd', 'http://example.com', 'http://localhost.evil.com', 'http://user:pass@127.0.0.1']) assert.equal(previewUrl(address), null);
});

test('preview server starts once, discovers its address, survives client absence and restarts its own process', async (t) => {
  const root = mkdtemp('preview-process'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = "const s=require('http').createServer((q,r)=>r.end('fixture'));s.listen(0,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+s.address().port+'/'));";
  const servers = new PreviewServers({ discover: async () => ({ bin: process.execPath, args: ['-e', script], command: 'fixture dev' }) });
  t.after(() => servers.stopAll());
  await servers.launch(root); await waitFor(() => servers.state(root).url);
  const old = servers.jobs.get(root).child.pid; const url = servers.state(root).url;
  assert.equal(await (await fetch(url)).text(), 'fixture');
  await servers.launch(root); assert.equal(servers.jobs.get(root).child.pid, old, 'no second server on repeated start');
  await servers.restart(root); await waitFor(() => servers.state(root).url);
  assert.notEqual(servers.jobs.get(root).child.pid, old); assert.equal(servers.state(root).status, 'running');
  await servers.stop(root); assert.equal(servers.state(root).status, 'stopped');
  await assert.rejects(fetch(servers.state(root).url));
  assert.equal(servers.state('/other').status, 'idle');
});

test('preview process failures retain real exit code and bounded output', async (t) => {
  const root = mkdtemp('preview-failure'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const servers = new PreviewServers({ discover: async () => ({ bin: process.execPath, args: ['-e', "console.error('x'.repeat(40000));process.exitCode=7"], command: 'fixture failure' }) });
  await servers.launch(root); await waitFor(() => servers.state(root).status === 'failed');
  assert.equal(servers.state(root).code, 7); assert.match(servers.state(root).error, /code 7/); assert.ok(servers.state(root).output.length <= 32768);
});
