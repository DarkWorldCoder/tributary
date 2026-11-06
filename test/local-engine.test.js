'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fork } = require('node:child_process');
const { LocalEngine, engineConfig } = require('../core/local-engine'), { LocalRequests, localRequests } = require('../core/local-requests');
const { spawnOwnedRuntime } = require('../core/local-engine-process');
const { Hub } = require('../core/hub'), { MemorySecrets } = require('../core/store'), { mkdtemp } = require('./helpers/tmp');
const fixture = path.join(__dirname, 'fake-local-engine.cjs');
const setup = (t, mode) => {
  const root = mkdtemp('local-engine'), modelPath = path.join(root, 'model.gguf'); fs.writeFileSync(modelPath, 'GGUF\x03\0\0\0');
  const engine = new LocalEngine({ dataDir: root, startupMs: 3000, stopMs: 500, spawnImpl: (file, args, options) => spawnOwnedRuntime(file, [fixture, ...args], { ...options, env: { ...process.env, FAKE_ENGINE_MODE: mode || '' } }) });
  t.after(() => engine.dispose());
  return { root, engine, config: { serverPath: process.execPath, modelPath, context: 1024, idleSeconds: 1, threads: 1 } };
};
test('engine settings require executable/model files and bounded context, CPU and idle values', t => {
  const { config } = setup(t);
  assert.equal(engineConfig(config).idleSeconds, 1);
  for (const bad of [{ serverPath: 'node' }, { modelPath: fixture }, { context: 1e9 }, { idleSeconds: 0 }, { threads: 32 }, { port: 80 }]) assert.throws(() => engineConfig({ ...config, ...bad }));
});
test('owned engine starts once, bounds credentials to a private file, sleeps on metadata reads, and reaps on stop', async t => {
  const { root, engine, config } = setup(t);
  const first = engine.start(config), second = engine.start(config); assert.equal(first, second);
  const state = await first, pid = engine.child.pid, key = engine.apiKey;
  assert.equal(state.active, true); assert.equal(state.status, 'ready'); assert.ok(!JSON.stringify(state).includes(key));
  const folder = fs.readdirSync(root).find(name => name.startsWith('local-engine-'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, folder, 'api-key')).mode & 0o777, 0o600);
  await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal((await engine.refresh()).status, 'sleeping');
  assert.equal((await engine.start(config)).status, 'sleeping', 'metadata/start on the same engine does not reload it');
  await assert.rejects(engine.start({ ...config, context: 4096 }), /Stop the current/);
  await engine.stop(); assert.equal(engine.state().active, false); assert.equal(engine.apiKey, '');
  assert.throws(() => process.kill(pid, 0)); assert.equal(fs.existsSync(path.join(root, folder)), false);
});
test('startup failure redacts the ephemeral credential and stop cancels a hung startup with no child left', async t => {
  const failed = setup(t, 'fail'); await assert.rejects(failed.engine.start(failed.config), /startup error/);
  assert.match(failed.engine.error, /redacted/); assert.equal(failed.engine.child, null);
  const hung = setup(t, 'hang'), work = hung.engine.start(hung.config); const result = assert.rejects(work, /stopped/);
  while (!hung.engine.child) await new Promise(resolve => setTimeout(resolve, 10)); const pid = hung.engine.child.pid;
  await hung.engine.stop(); await result; assert.throws(() => process.kill(pid, 0)); assert.equal(hung.engine.status, 'stopped');
});
test('exclusive service ownership refuses active and queued calls and rejects new requests while stopping', async () => {
  const requests = new LocalRequests(), gateway = { baseUrl: 'http://localhost:8080/v1', localConcurrency: 1 };
  const release = await requests.acquire(gateway); assert.throws(() => requests.exclusive(gateway), /in use/); release();
  const unlock = requests.exclusive(gateway); await assert.rejects(requests.acquire({ ...gateway, baseUrl: 'http://127.0.0.1:8080/v1' }), /being stopped/);
  unlock(); const next = await requests.acquire(gateway); next(); assert.deepEqual(requests.counts(), { services: 0, active: 0, waiting: 0 });
});
test('Hub reconnects only owned profiles across engine restarts and keeps keys out of state/database', async t => {
  const { root, engine, config } = setup(t), hub = new Hub({ dataDir: root, secrets: new MemorySecrets(), home: root }); hub._localEngine = engine;
  t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  const before = await hub.startLocalEngine(config);
  const id = await hub.connectLocalModel({ service: 'llamacpp', baseUrl: before.baseUrl, model: before.model });
  const key = engine.apiKey; assert.ok(hub.state().gateways.find(g => g.id === id).managedLocal);
  await hub.saveGateway({ ...hub.store.data.gateways.find(g => g.id === id), localConcurrency: 4 });
  assert.equal(hub.store.data.gateways.find(g => g.id === id).localConcurrency, 1, 'owned CPU runtime has one native generation slot');
  assert.ok(!JSON.stringify(hub.state()).includes(key)); hub.store.save(true); assert.ok(!fs.readFileSync(path.join(root, 'tributary.db')).includes(key));
  const release = await localRequests.acquire({ baseUrl: before.baseUrl }); await assert.rejects(hub.stopLocalEngine(), /in use/); release();
  await hub.stopLocalEngine(); await assert.rejects(hub.resolveGateway(id), /Start the app-managed/);
  const restarted = await hub.startLocalEngine(before.config), resolved = await hub.resolveGateway(id);
  assert.equal(restarted.baseUrl, before.baseUrl); assert.equal(restarted.model, before.model); assert.equal(resolved.baseUrl, restarted.baseUrl);
  assert.equal(resolved.apiKey, engine.apiKey); assert.notEqual(resolved.apiKey, key);
  assert.equal(await hub.connectLocalModel({ service: 'llamacpp', baseUrl: restarted.baseUrl, model: restarted.model }), id);
  const manual = await hub.saveGateway({ ...resolved, id: undefined, name: 'Manual', baseUrl: 'http://127.0.0.1:9999/v1' });
  assert.equal(hub.state().gateways.find(g => g.id === manual).managedLocal, undefined);
  const reply = []; const { runDirectTurn } = require('../core/direct');
  assert.equal((await runDirectTurn({ gateway: resolved, prompt: 'Hello', onEvent: event => reply.push(event) })).text, 'Connected');
  await hub.stopLocalEngine(); assert.equal(hub.state().gateways.find(g => g.id === manual).baseUrl, 'http://127.0.0.1:9999/v1');
});
test('parent SIGKILL closes ownership IPC and the guardian reaps its runtime and private key', async t => {
  const root = mkdtemp('engine-parent-death'); fs.writeFileSync(path.join(root, 'model.gguf'), 'GGUF\x03\0\0\0');
  const parent = fork(path.join(__dirname, 'local-engine-parent.cjs'), [root], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (parent.exitCode === null && !parent.signalCode) parent.kill('SIGKILL'); });
  const data = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Parent fixture did not start')), 10000); parent.once('message', value => { clearTimeout(timer); resolve(value); }); parent.once('error', reject); });
  assert.ok(data.guardianPid && data.runtimePid);
  const exited = new Promise(resolve => parent.once('exit', resolve)); parent.kill('SIGKILL'); await exited;
  const alive = pid => { try { process.kill(pid, 0); if (process.platform === 'linux' && /\) Z /.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8'))) return false; return true; } catch { return false; } };
  const end = Date.now() + 5000; while ((alive(data.runtimePid) || alive(data.guardianPid)) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(alive(data.runtimePid), false); assert.equal(alive(data.guardianPid), false);
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('local-engine-')), []);
});

test('a local coding agent paused for approval still owns the engine after its generation slot is released', async t => {
  const { root, engine, config } = setup(t, 'tool');
  const hub = new Hub({ dataDir: root, home: root, secrets: new MemorySecrets(), approvals: true }); hub._localEngine = engine;
  t.after(() => { for (const id of hub.running.keys()) hub.stop(id); hub.fileWatches.close(); hub.store.close(); });
  const state = await hub.startLocalEngine(config);
  const id = await hub.connectLocalModel({ service: 'llamacpp', baseUrl: state.baseUrl, model: state.model, localAgent: true });
  const cwd = path.join(root, 'project'); fs.mkdirSync(cwd); hub.addProject(cwd, { trusted: true });
  const thread = hub.createThread(cwd, 'Paused owned agent');
  let timer;
  const approval = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error('Agent did not request command approval')), 10000);
    hub.on('permission', event => { if (event.request.status === 'pending') resolve(event); });
  }).finally(() => clearTimeout(timer));
  const work = hub.send({ threadId: thread.id, agentId: 'direct:' + id, text: 'Check the project with a command.', mode: 'edit' });
  await approval; assert.equal(localRequests.counts().active, 0);
  await assert.rejects(hub.stopLocalEngine(), /active chats/);
  hub.stop(thread.id); assert.equal((await work).ok, false);
  await hub.stopLocalEngine(); assert.equal(engine.child, null);
});
