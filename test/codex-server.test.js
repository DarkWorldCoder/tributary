'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os'); const { once } = require('node:events');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
const agent = { id: 'codex-native', name: 'Codex native fixture', protocol: 'codex-exec', controlProtocol: 'codex-app-server', available: true, path: process.execPath, serverArgs: [path.join(__dirname, 'fake-codex-server.js')] };
function setup(t, approvals = true) { const root = mkTmp('codex-native'); const hub = new Hub({ dataDir: path.join(root, 'data'), home: root, secrets: new MemorySecrets(), approvals }); const project = path.join(root, 'project'); fs.mkdirSync(project); hub.addProject(project); hub.agents = [agent]; t.after(() => { hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { hub, thread: hub.createThread(project) }; }
const nextRequest = async (hub) => { while (true) { const [event] = await once(hub, 'permission', { signal: AbortSignal.timeout(8000) }); if (event.request.status === 'pending') return event.request; } };
test('Codex native app-server streams tools and plans, approves commands and resumes its session', async (t) => {
 const { hub, thread } = setup(t); hub.on('permission', ({ request }) => { if (request.status === 'pending') hub.answerPermission(request.id, 'once'); });
 const first = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'Inspect project', mode: 'edit' }); assert.equal(first.ok, true); assert.match(first.text, /Native accept/); assert.equal((first.text.match(/Native/g) || []).length, 1); assert.equal(first.tools[0].status, 'done'); assert.equal(first.tools[0].input.command, 'npm test'); assert.equal(first.plan[0].text, 'Inspect project');
 const next = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'Continue', mode: 'edit' }); assert.equal(next.resumed, true); assert.match(next.text, /resumed:true/); assert.equal(hub.permissions().length, 0);
});
test('Codex native app-server rejects prompts without a host and refuses read-only edits', async (t) => {
 const { hub, thread } = setup(t, false); const result = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'Check', mode: 'edit' }); assert.match(result.text, /Native decline/);
 const { hub: read, thread: rt } = setup(t); const edit = await read.send({ threadId: rt.id, agentId: agent.id, text: 'EDIT fixture', mode: 'read' }); assert.match(edit.text, /Native decline/); assert.equal(read.permissions().length, 0);
});
test('Codex native user-input questions return selected answers through the shared chat controls', async (t) => {
 const { hub, thread } = setup(t); hub.on('permission', ({ request }) => { if (request.status === 'pending') hub.answerPermission(request.id, { answers: { 'Which database?': 'SQLite' } }); });
 const result = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'QUESTION', mode: 'edit' }); assert.match(result.text, /SQLite/); assert.equal(result.ok, true);
});
test('Codex native stop interrupts the active turn and cancels its pending approval', async (t) => {
 const { hub, thread } = setup(t); const asked = nextRequest(hub); const turn = hub.send({ threadId: thread.id, agentId: agent.id, text: 'Wait', mode: 'edit' }); await asked; hub.stop(thread.id); const result = await turn; assert.equal(result.ok, false); assert.equal(hub.permissions().length, 0); assert.equal(result.permissions[0].status, 'cancelled');
});

test('Codex additional access grants are shown explicitly and cannot grant writes in Read-only', async (t) => {
 const { hub, thread } = setup(t); hub.on('permission', ({ request }) => { if (request.status === 'pending') { assert.equal(request.kind, 'permissions'); assert.match(request.detail, /fixture\/output/); hub.answerPermission(request.id, 'once'); } });
 const result = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'PERMISSIONS', mode: 'edit' }); assert.match(result.text, /fixture\/output/);
 const { hub: read, thread: rt } = setup(t); const denied = await read.send({ threadId: rt.id, agentId: agent.id, text: 'PERMISSIONS', mode: 'read' }); assert.ok(denied.notices.some((text) => text.includes('Additional write access'))); assert.equal(read.permissions().length, 0); assert.ok(!denied.text.includes('fixture/output'));
});

test('Codex native attachment input includes the actual stored local image', async (t) => {
 const { hub, thread } = setup(t); hub.on('permission', ({ request }) => { if (request.status === 'pending') hub.answerPermission(request.id, 'once'); });
 const [image] = hub.addAttachments([{ name: 'reference.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=' }]);
 const result = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'Inspect image', attachments: [image.id], mode: 'read' }); assert.match(result.text, /images:1/); assert.equal(result.ok, true);
});
