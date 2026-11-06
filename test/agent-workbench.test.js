'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openWorkbench, replyWorkbench } = require('../core/workbench');
const { executeTool, definitions } = require('../core/local-agent');
async function fixture(t, mode = 'edit') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-agent-editor-'));
  fs.writeFileSync(path.join(cwd, 'main.ts'), 'original\n');
  const hub = new EventEmitter(); const controller = new AbortController();
  let trusted = true; const approvals = [];
  Object.assign(hub, { approvals: true, project: () => ({ trusted }), workdir: () => cwd, agent: () => ({ id: 'test' }), askPermission: async (...args) => { approvals.push(args); return 'once'; } });
  const requests = []; hub.on('workbench', request => requests.push(request));
  const bridge = await openWorkbench(hub, { id: 'thread', project: cwd }, { id: 'message', agent: 'test' }, { mode, signal: controller.signal });
  t.after(() => { bridge.close(); fs.rmSync(cwd, { recursive: true, force: true }); });
  const respond = async operation => { const before = requests.length; const promise = operation(); const deadline = Date.now() + 2000; while (requests.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); const request = requests.at(-1); assert.ok(request); replyWorkbench(hub, request.id, { acknowledged: request.action }); return promise; };
  return { hub, bridge, requests, approvals, controller, cwd, respond, untrust: () => { trusted = false; } };
}
test('editor commands require real acknowledgement and local models use the same tool', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.respond(() => executeTool({ workbench: f.bridge.call }, 'editor', { action: 'open_file', path: 'main.ts', line: 2 })), { acknowledged: 'open_file' });
  assert.equal(f.requests[0].threadId, 'thread'); assert.equal(f.requests[0].project, f.cwd);
  assert.ok(definitions({ writing: true, workbench: f.bridge.call }).some(tool => tool.function.name === 'editor'));
  assert.ok(!definitions({ writing: true }).some(tool => tool.function.name === 'editor'));
  assert.equal(replyWorkbench(f.hub, f.requests[0].id, {}), false);
});
test('edits follow approvals; denial, read mode, invalid paths and unknown actions never reach the editor', async t => {
  const f = await fixture(t);
  await f.respond(() => f.bridge.call('edit_editor', { path: 'main.ts', revision: 'rev', old_text: 'original', new_text: 'next' }));
  assert.equal(f.approvals.length, 1);
  f.hub.askPermission = async () => 'reject';
  const count = f.requests.length;
  await assert.rejects(f.bridge.call('save_editor', { path: 'main.ts', revision: 'rev' }), /denied/);
  await assert.rejects(f.bridge.call('eval', { content: 'process.exit()' }), /Unknown/);
  await assert.rejects(f.bridge.call('open_file', { path: '../outside' }), /outside|relative|ENOENT/i);
  await assert.rejects(f.bridge.call('open_file', { path: 'main.ts', line: -1 }), /line/);
  await assert.rejects(f.bridge.call('split_editor', { direction: 'any' }), /right or down/);
  await assert.rejects(f.bridge.call('edit_editor', { path: 'main.ts', revision: 'rev', old_text: 'x', new_text: 'x'.repeat(120001) }), /120,000/);
  assert.equal(f.requests.length, count);
  const read = await fixture(t, 'read'); await assert.rejects(read.bridge.call('undo', { path: 'main.ts', revision: 'rev' }), /read-only/);
  f.untrust(); await assert.rejects(f.bridge.call('read_editor'), /trusted/);
});
test('HTTP bridge rejects missing credentials and browser origins, then acknowledges an authenticated request', async t => {
  const f = await fixture(t, 'full'), url = f.bridge.env.TRIBUTARY_EDITOR_URL;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${f.bridge.env.TRIBUTARY_EDITOR_TOKEN}`, origin: 'https://example.com' }, body: '{}' })).status, 403);
  const response = await f.respond(async () => { const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${f.bridge.env.TRIBUTARY_EDITOR_TOKEN}` }, body: JSON.stringify({ action: 'status' }) }); return res.json(); });
  assert.deepEqual(response, { result: { acknowledged: 'status' } });
  const cli = await f.respond(async () => { const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, [path.resolve(__dirname, '../core/workbench-cli.js'), 'status'], { env: { ...process.env, ...f.bridge.env } }); return JSON.parse(stdout); });
  assert.deepEqual(cli, { acknowledged: 'status' });
  const unicodePath = 'नेपाली.ts'; fs.writeFileSync(path.join(f.cwd, unicodePath), 'hello');
  const unicode = await f.respond(() => new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ action: 'open_file', path: unicodePath })), at = body.indexOf(Buffer.from('न')) + 1;
    const req = require('node:http').request(url, { method: 'POST', headers: { authorization: `Bearer ${f.bridge.env.TRIBUTARY_EDITOR_TOKEN}` } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve(JSON.parse(text))); });
    req.on('error', reject); req.write(body.subarray(0, at)); setTimeout(() => req.end(body.subarray(at)), 10);
  }));
  assert.deepEqual(unicode, { result: { acknowledged: 'open_file' } }); assert.equal(f.requests.at(-1).input.path, unicodePath);
});
test('one command at a time; cancellation and end of turn release outstanding requests', async t => {
  const f = await fixture(t), first = f.bridge.call('status');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.bridge.call('status'), /previous/);
  const rejection = assert.rejects(first, /cancelled/); f.controller.abort(); await rejection; assert.equal(f.requests.at(-1).action, 'cancel');
  assert.equal(replyWorkbench(f.hub, f.requests[0].id, {}), false);
  await assert.rejects(f.bridge.call('status'), /ended/);
  const next = await fixture(t), pending = next.bridge.call('status'); await new Promise(resolve => setImmediate(resolve));
  const ended = assert.rejects(pending, /ended/); next.bridge.close(); await ended;
});

test('a native coding turn receives and uses the scoped editor command bridge', async t => {
  const { Hub } = require('../core/hub'), { MemorySecrets } = require('../core/store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-editor-'));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const hub = new Hub({ dataDir: path.join(root, 'data'), home: root, secrets: new MemorySecrets() });
  t.after(() => { hub.fileWatches.close(); hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const code = `let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',async()=>{const r=await fetch(process.env.TRIBUTARY_EDITOR_URL,{method:'POST',headers:{authorization:'Bearer '+process.env.TRIBUTARY_EDITOR_TOKEN},body:JSON.stringify({action:'status'})});const data=await r.json();console.log(JSON.stringify({type:'item.completed',item:{id:'result',type:'agent_message',text:JSON.stringify({status:data.result,prompted:prompt.includes('## Tributary editor')})}}));console.log(JSON.stringify({type:'turn.completed'}));});`;
  hub.agents = [{ id: 'fixture-editor', name: 'Fixture', protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true, args: () => ['-e', code] }];
  hub.on('workbench', request => replyWorkbench(hub, request.id, { project: request.project }));
  const thread = hub.createThread(project, 'Native editor');
  const message = await hub.send({ threadId: thread.id, agentId: 'fixture-editor', text: 'Inspect the editor.', mode: 'read' });
  assert.equal(message.ok, true);
  assert.deepEqual(JSON.parse(message.text), { status: { project }, prompted: true });
});
