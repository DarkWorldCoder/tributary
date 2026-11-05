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

function deferred() {
  let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(setImmediate);
const idleCommand = { bin: process.execPath, args: ['-e', "setInterval(()=>{},1000)"], command: 'fixture preview' };

test('stopping discovery settles launch immediately and a late discovery failure cannot restart it', { timeout: 5000 }, async (t) => {
  const root = mkdtemp('preview-cancel-discovery'); const discovery = deferred(); let environmentCalls = 0;
  const servers = new PreviewServers({ discover: () => discovery.promise }); t.after(() => servers.stopAll());
  const launching = servers.launch(root, async () => { environmentCalls++; return {}; });
  assert.equal(servers.state(root).status, 'starting'); assert.equal(servers.pending.size, 1);
  assert.equal((await servers.stop(root)).status, 'stopped'); await launching;
  assert.equal(servers.pending.size, 0); assert.equal(environmentCalls, 0);
  discovery.reject(new Error('Late discovery error')); await tick();
  assert.equal(servers.state(root).status, 'stopped'); assert.equal(servers.state(root).error, ''); assert.equal(servers.jobs.get(root).child, null);
});

test('stopAll cancels both discovery and lazy environment preparation without waiting for either', { timeout: 5000 }, async (t) => {
  const root = mkdtemp('preview-cancel-all'); const other = path.join(root, 'other'); fs.mkdirSync(other);
  const discovery = deferred(); const environment = deferred();
  const servers = new PreviewServers({ discover: (project) => project === root ? idleCommand : discovery.promise }); t.after(() => servers.stopAll());
  const one = servers.launch(root, () => environment.promise); const two = servers.launch(other);
  await tick(); assert.equal(servers.pending.size, 2);
  await servers.stopAll(); await Promise.all([one, two]); assert.equal(servers.pending.size, 0);
  environment.resolve({ FIXTURE_ENV: 'not-started' }); discovery.resolve(idleCommand); await tick();
  for (const project of [root, other]) { assert.equal(servers.state(project).status, 'stopped'); assert.equal(servers.jobs.get(project).child, null); }
});

test('a cancelled launch cannot delete or replace a newer startup for the same project', async (t) => {
  const root = mkdtemp('preview-new-startup'); const old = deferred(); const newer = deferred(); let calls = 0;
  const servers = new PreviewServers({ discover: () => ++calls === 1 ? old.promise : newer.promise }); t.after(() => servers.stopAll());
  const first = servers.launch(root); await servers.stop(root); const second = servers.launch(root);
  old.resolve(idleCommand); await first; await tick(); assert.equal(servers.pending.size, 1); assert.equal(servers.state(root).status, 'starting');
  newer.resolve(idleCommand); await second; await waitFor(() => servers.state(root).status === 'running');
  const job = servers.jobs.get(root); const child = job.child;
  await Promise.all([servers.stop(root), servers.stop(root), servers.stop(root)]);
  assert.equal(servers.state(root).status, 'stopped'); assert.equal(job.child, null); assert.equal(job.done, null); assert.equal(job.timer, null);
  assert.equal(child.stdout.listenerCount('data'), 0); assert.equal(child.stderr.listenerCount('data'), 0);
  assert.equal(child.listenerCount('error'), 0); assert.equal(servers.pending.size, 0);
});

test('preview logs decode fragmented UTF-8 independently and retain only a bounded valid tail', async (t) => {
  const root = mkdtemp('preview-utf8'); const text = '🙂 café नमस्ते';
  for (const stream of ['stdout', 'stderr']) {
    const script = `(async()=>{process.${stream}.write('x'.repeat(50000));const bytes=Buffer.from(${JSON.stringify(text)});for(let i=0;i<bytes.length;i++){process.${stream}.write(bytes.subarray(i,i+1));await new Promise(r=>setTimeout(r,2));}})();`;
    const servers = new PreviewServers({ discover: async () => ({ bin: process.execPath, args: ['-e', script], command: 'fixture UTF-8' }) }); t.after(() => servers.stopAll());
    await servers.launch(root); await waitFor(() => servers.state(root).status === 'stopped');
    const state = servers.state(root); assert.ok(state.output.endsWith(text), stream); assert.equal(state.output.includes('\ufffd'), false);
    assert.ok(state.output.length <= 32768); assert.equal(servers.jobs.get(root).timer, null);
  }
});

test('repeated finished previews release child listeners and timers without delayed state events', async (t) => {
  const root = mkdtemp('preview-finished-resources'); let changes = 0;
  const servers = new PreviewServers({ discover: async () => ({ bin: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(60000));"], command: 'fixture output' }) }); t.after(() => servers.stopAll());
  servers.on('state', () => changes++);
  for (let index = 0; index < 10; index++) {
    await servers.launch(root); const job = servers.jobs.get(root); const child = job.child;
    await waitFor(() => job.status === 'stopped');
    assert.equal(job.child, null); assert.equal(job.done, null); assert.equal(job.timer, null);
    assert.equal(child.stdout.listenerCount('data'), 0); assert.equal(child.stderr.listenerCount('data'), 0);
    assert.equal(child.listenerCount('spawn'), 0); assert.equal(child.listenerCount('error'), 0);
    assert.equal(servers.pending.size, 0); assert.equal(servers.jobs.size, 1); assert.ok(job.output.length <= 32768);
  }
  const settled = changes; await new Promise((resolve) => setTimeout(resolve, 150)); assert.equal(changes, settled);
});

test('discovery and environment failures leave a failed state and release pending startup ownership', async (t) => {
  const root = mkdtemp('preview-prepare-failure'); const servers = new PreviewServers({ discover: async () => { throw new Error('Discovery failed'); } }); t.after(() => servers.stopAll());
  await assert.rejects(servers.launch(root), /Discovery failed/); assert.equal(servers.pending.size, 0); assert.equal(servers.state(root).status, 'failed');
  servers.discover = async () => idleCommand;
  await assert.rejects(servers.launch(root, async () => { throw new Error('Environment failed'); }), /Environment failed/);
  assert.equal(servers.pending.size, 0); assert.equal(servers.jobs.get(root).child, null); assert.equal(servers.state(root).error, 'Environment failed');
});
