'use strict';
// ACP registry: discover agents published at agentclientprotocol.com and add them as runnable ACP agents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRegistry, registryEntry, addRegistryAgent, loadRegistry } = require('../core/registry');
const { detectAgents } = require('../core/agents');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'acp-registry.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-reg-'));

test('registry entries say how each agent runs: npx, uvx, or a manual binary download', () => {
  const list = parseRegistry(FIX);
  const by = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.strictEqual(by['qwen-code'].install.kind, 'npx');
  assert.deepStrictEqual([by['qwen-code'].install.command, by['qwen-code'].install.args[0]], ['npx', '-y']);
  assert.ok(by['qwen-code'].install.args.includes(FIX.agents.find((a) => a.id === 'qwen-code').distribution.npx.package));
  assert.strictEqual(by['fast-agent'].install.kind, 'uvx');
  assert.strictEqual(by['amp-acp'].install.kind, 'binary');
  assert.strictEqual(by['amp-acp'].install.runnable, false);
  assert.strictEqual(by.opencode.install.kind, 'binary');
  for (const a of list) { assert.ok(a.name); assert.ok(a.id); }
});

test('adding a registry agent writes a custom ACP agent that detection picks up', async () => {
  const dir = tmp(); const file = path.join(dir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify({ agents: [{ id: 'mine', name: 'Mine', command: 'x', args: [], protocol: 'text' }] }));
  const op = parseRegistry(FIX).find((a) => a.id === 'qwen-code');
  const entry = registryEntry(op);
  assert.strictEqual(entry.protocol, 'acp');
  assert.strictEqual(entry.command, 'npx');
  addRegistryAgent(file, op);
  addRegistryAgent(file, op); // idempotent
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).agents;
  assert.deepStrictEqual(saved.map((a) => a.id), ['mine', 'acp:qwen-code']);
  const bin = tmp(); fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, 'npx'), 0o755);
  const agents = await detectAgents({ customFile: file, env: { PATH: bin }, probeVersions: false });
  const a = agents.find((x) => x.id === 'acp:qwen-code');
  assert.ok(a && a.available && a.headless, JSON.stringify(a));
  assert.strictEqual(a.protocol, 'acp');
  assert.deepStrictEqual(a.acpArgs, entry.acpArgs);
  assert.throws(() => addRegistryAgent(file, parseRegistry(FIX).find((x) => x.id === 'amp-acp')), /download/);
});

test('loadRegistry falls back to the cached copy when offline', async () => {
  const cache = path.join(tmp(), 'acp-registry.json');
  const online = await loadRegistry({ cacheFile: cache, fetchImpl: async () => ({ ok: true, json: async () => FIX }) });
  assert.strictEqual(online.source, 'network');
  const offline = await loadRegistry({ cacheFile: cache, fetchImpl: async () => { throw new Error('offline'); } });
  assert.strictEqual(offline.source, 'cache');
  assert.strictEqual(offline.agents.length, online.agents.length);
  await assert.rejects(loadRegistry({ cacheFile: path.join(tmp(), 'none.json'), fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
});

test('the hub lists registry agents with install state, installs and removes them, and rescans', async () => {
  const dir = tmp();
  const { Hub } = require('../core/hub');
  const { MemorySecrets } = require('../core/store');
  let calls = 0;
  const hub = new Hub({ dataDir: dir, secrets: new MemorySecrets(), home: dir, fetchImpl: async () => { calls++; return { ok: true, json: async () => FIX }; } });
  const reg = await hub.registry();
  assert.strictEqual(reg.source, 'network');
  const qwen = reg.agents.find((a) => a.id === 'qwen-code');
  assert.deepStrictEqual([qwen.installed, qwen.install.kind, qwen.install.runnable], [false, 'npx', true]);
  assert.strictEqual(reg.agents.find((a) => a.id === 'goose').install.kind, 'binary');

  const entry = await hub.installRegistryAgent('qwen-code');
  assert.strictEqual(entry.id, 'acp:qwen-code');
  assert.ok(hub.state().agents.some((a) => a.id === 'acp:qwen-code'), 'install rescans so the new agent is listed');
  assert.strictEqual(calls, 1, 'install reuses the list it just showed');
  assert.strictEqual((await hub.registry()).agents.find((a) => a.id === 'qwen-code').installed, true);
  await assert.rejects(hub.installRegistryAgent('goose'), /download/);
  await assert.rejects(hub.installRegistryAgent('nope'), /not in the ACP registry/);

  assert.strictEqual(await hub.removeRegistryAgent('qwen-code'), true);
  assert.ok(!hub.state().agents.some((a) => a.id === 'acp:qwen-code'));
  assert.strictEqual(await hub.removeRegistryAgent('acp:qwen-code'), false);
  await assert.rejects(hub.removeRegistryAgent('claude'), /registry/, 'only registry agents can be removed here');

  hub.fetchImpl = async () => { throw new Error('offline'); };
  assert.strictEqual((await hub.registry({ refresh: true })).source, 'cache');
});
