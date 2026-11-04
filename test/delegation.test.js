'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { openDelegation } = require('../core/delegation');
const until = async (fn) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 20000) throw new Error('Timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const reply = (text) => `console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:${JSON.stringify(text)}}}));console.log(JSON.stringify({type:'turn.completed'}));`;
const agent = (id, script) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true, args: () => ['-e', script] });
async function fixture(t) {
  const root = mkTmp('agent-delegation'); const project = path.join(root, 'project'); fs.mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project }); fs.writeFileSync(path.join(project, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', '.'], { cwd: project }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initial fixture'], { cwd: project });
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets() }); hub.addProject(project);
  const parent = hub.createThread(project, 'Parent chat'); parent.messages.push({ id: 'context', role: 'user', text: 'Keep the original project unchanged; use the existing fixture API.' });
  t.after(async () => { hub.stop(parent.id); await until(() => !hub.running.size); hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  hub.agents = [agent('worker', `let input='';process.stdin.on('data',b=>input+=b).on('end',()=>{require('fs').writeFileSync('worker.json',JSON.stringify({context:input.includes('existing fixture API'),credential:!!process.env.TRIBUTARY_DELEGATE_TOKEN}));setTimeout(()=>{${reply('Worker built the fixture and checked it')}},150)});`)];
  return { hub, root, project, parent };
}

test('an ordinary chatting agent starts background chats through its scoped command and reads real results', async (t) => {
  const { hub, project, parent } = await fixture(t);
  const cli = path.resolve(__dirname, '../core/delegate-cli.js');
  hub.agents.push(agent('parent', `let input='';process.stdin.on('data',b=>input+=b).on('end',async()=>{try {
    if(!input.includes('## Background coding workers'))throw new Error('Missing delegation instructions');
    const {execFileSync}=require('child_process');const call=(...args)=>JSON.parse(execFileSync(process.execPath,[${JSON.stringify(cli)},...args],{encoding:'utf8'}));
    const available=call('agents');if(!available.some(a=>a.id==='worker'))throw new Error('No worker');
    const one=call('start','--agent','worker','--task','Build the first fixture');const two=call('start','--agent','worker','--task','Build the second fixture');
    let results;for(let i=0;i<100;i++){results=call('list');if(results.every(x=>x.status==='done'))break;await new Promise(r=>setTimeout(r,30))}
    if(results.length!==2||!results.every(x=>x.status==='done'&&x.result.includes('checked it')))throw new Error('Workers incomplete');
    ${reply('Both background workers completed')}
  }catch(error){console.error(error.message);process.exitCode=1}});`));
  const result = await hub.send({ threadId: parent.id, agentId: 'parent', text: 'Start two background agents for this task', mode: 'edit' });
  assert.equal(result.ok, true, result.error); assert.match(result.text, /Both background workers completed/);
  const children = hub.store.data.threads.filter((chat) => chat.delegation?.parentThreadId === parent.id);
  assert.equal(children.length, 2); assert.notEqual(children[0].worktree.cwd, children[1].worktree.cwd);
  assert.ok(!fs.existsSync(path.join(project, 'worker.json')));
  for (const child of children) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(child.worktree.cwd, 'worker.json'))), { context: true, credential: false });
    assert.equal(child.messages[0].text, child.title); assert.equal(child.delegation.state, 'done');
  }
  assert.deepEqual(result.delegations.map((child) => child.state), ['done', 'done']);
  for (const child of result.delegations) { assert.ok(child.branch); assert.ok(child.files.includes('worker.json')); assert.ok(child.fileCount >= 1); assert.equal(child.error, ''); }
});

test('workers continue after their parent finishes, and the next parent turn can inspect them', async (t) => {
  const { hub, parent } = await fixture(t); const controller = new AbortController();
  const bridge = await openDelegation(hub, parent, { id: 'turn1' }, { mode: 'edit', signal: controller.signal });
  const child = await bridge.call('start', { agentId: 'worker', task: 'Independent worker' }); bridge.close();
  await until(() => !hub.running.has(child.id) && hub.thread(child.id).delegation.state === 'done');
  const next = await openDelegation(hub, parent, { id: 'turn2' }, { mode: 'edit' }); t.after(() => next.close());
  assert.equal((await next.call('status', { id: child.id })).status, 'done');
  hub.thread(child.id).delegation.state = 'running';
  assert.equal((await next.call('status', { id: child.id })).status, 'interrupted');
  await assert.rejects(bridge.call('list'), /ended/);
  await assert.rejects(fetch(bridge.env.TRIBUTARY_DELEGATE_URL, { method: 'POST' }));
});

test('delegation checks permissions, credentials, chat ownership and worker limits', async (t) => {
  const { hub, parent, project } = await fixture(t);
  await assert.rejects(openDelegation(hub, parent, { id: 'read' }, { mode: 'read' }), /Edit files/);
  await assert.rejects(openDelegation(hub, { ...parent, delegation: {} }, { id: 'nested' }, { mode: 'edit' }), /trusted coding/);
  const bridge = await openDelegation(hub, parent, { id: 'scope' }, { mode: 'edit' }); t.after(() => bridge.close());
  hub.setSettings({ agentDelegation: false }); await assert.rejects(bridge.call('start', { agentId: 'worker', task: 'Disabled' }), /disabled/); hub.setSettings({ agentDelegation: true });
  const denied = await fetch(bridge.env.TRIBUTARY_DELEGATE_URL, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' }); assert.equal(denied.status, 403);
  const browser = await fetch(bridge.env.TRIBUTARY_DELEGATE_URL, { method: 'POST', headers: { authorization: `Bearer ${bridge.env.TRIBUTARY_DELEGATE_TOKEN}`, origin: 'http://evil.example' }, body: '{}' }); assert.equal(browser.status, 403);
  const other = hub.createThread(project, 'Unrelated chat'); await assert.rejects(bridge.call('stop', { id: other.id }), /not found/);
  await assert.rejects(bridge.call('start', { agentId: 'missing', task: 'Build' }), /available coding/);
  hub.agents.push({ id: 'direct', available: true, protocol: 'direct-chat' }); await assert.rejects(bridge.call('start', { agentId: 'direct', task: 'Build' }), /available coding/);
  hub.agents[0] = agent('worker', `process.stdin.resume();setTimeout(()=>{${reply('slow worker')}},60000)`);
  const [one, two] = await Promise.all([bridge.call('start', { agentId: 'worker', task: 'One' }), bridge.call('start', { agentId: 'worker', task: 'Two' })]);
  await assert.rejects(bridge.call('start', { agentId: 'worker', task: 'Third active worker' }), /Two background workers/);
  hub.stop(parent.id); await until(() => !hub.running.has(one.id) && !hub.running.has(two.id));
  assert.ok([one, two].every((child) => hub.thread(child.id).delegation.cancelled));
  await until(() => [one, two].every((child) => hub.thread(child.id).delegation.state === 'stopped'));
  const source = hub.thread(one.id); source.delegation.state = 'stopped'; hub.thread(two.id).delegation.state = 'stopped';
  for (let i = 0; i < 2; i++) { const child = hub.createThread(project, 'Completed child'); child.delegation = { parentThreadId: parent.id, parentMessageId: 'scope', state: 'done' }; }
  await assert.rejects(bridge.call('start', { agentId: 'worker', task: 'Fifth worker' }), /four worker chats/);
});

test('read-only and disabled chat turns do not receive delegation credentials or instructions', async (t) => {
  const { hub, parent } = await fixture(t);
  hub.agents = [agent('observer', `let input='';process.stdin.on('data',b=>input+=b).on('end',()=>{if(process.env.TRIBUTARY_DELEGATE_TOKEN||input.includes('## Background coding workers'))process.exit(4);${reply('No delegation access')}});`)];
  assert.equal((await hub.send({ threadId: parent.id, agentId: 'observer', text: 'Read this project', mode: 'read' })).ok, true);
  hub.setSettings({ agentDelegation: false });
  assert.equal((await hub.send({ threadId: parent.id, agentId: 'observer', text: 'Work without delegation', mode: 'edit' })).ok, true);
});

test('delegated workers inherit a compatible source and can explicitly switch configured providers', async (t) => {
 const { hub, parent } = await fixture(t); hub.agents[0].gateways = ['openai'];
 const local = await hub.saveGateway({ name: 'Local fixture', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', apiKey: 'private-fixture-key' });
 const other = await hub.saveGateway({ name: 'Other fixture', protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: 'other-model' });
 const bridge = await openDelegation(hub, parent, { id: 'providers', gatewayId: local, model: 'local-model' }, { mode: 'edit' }); t.after(() => bridge.close());
 const sources = await bridge.call('sources'); assert.ok(sources.some((g) => g.id === local)); assert.ok(!JSON.stringify(sources).includes('private-fixture-key'));
 const one = await bridge.call('start', { agentId: 'worker', task: 'Use local provider' }); await until(() => hub.thread(one.id).delegation.state === 'done');
 assert.equal(hub.thread(one.id).delegation.gatewayId, local); assert.equal(hub.thread(one.id).messages.at(-1).gatewayId, local);
 const two = await bridge.call('start', { agentId: 'worker', task: 'Use another provider', gatewayId: other }); await until(() => hub.thread(two.id).delegation.state === 'done');
 assert.equal((await bridge.call('status', { id: two.id })).gatewayId, other);
 hub.agents[0].gateways = []; await assert.rejects(bridge.call('start', { agentId: 'worker', task: 'Incompatible provider' }), /cannot use the selected model source/);
 hub.setSettings({ delegationSource: 'native' }); const three = await bridge.call('start', { agentId: 'worker', task: 'Explicit own-account default' }); await until(() => hub.thread(three.id).delegation.state === 'done'); assert.equal(hub.thread(three.id).delegation.gatewayId, null);
});
test('subagent concurrency is configurable and capped at four independent background chats', async (t) => {
 const { hub, parent } = await fixture(t); assert.throws(() => hub.setSettings({ delegationConcurrency: 99 }), /1, 2 or 4/); assert.throws(() => hub.setSettings({ delegationSource: 'missing' }), /configured coding-agent source/);
 hub.setSettings({ delegationConcurrency: 4 }); hub.agents[0] = agent('worker', 'process.stdin.resume();setTimeout(()=>{},60000)');
 const bridge = await openDelegation(hub, parent, { id: 'four-workers' }, { mode: 'edit' }); t.after(() => bridge.close());
 const workers = await Promise.all([1, 2, 3, 4].map((n) => bridge.call('start', { agentId: 'worker', task: `Independent piece ${n}` })));
 assert.equal(new Set(workers.map((worker) => worker.workingCopy)).size, 4); assert.equal(hub.running.size, 4);
 await assert.rejects(bridge.call('start', { agentId: 'worker', task: 'Fifth worker' }), /four worker chats/); hub.stop(parent.id); await until(() => !hub.running.size);
});
