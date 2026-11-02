'use strict';
// ACP agents stay alive per agent and folder, get the project's MCP servers, respawn after a crash.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAcp, acpPool } = require('../core/acp');

const FAKE = path.join(__dirname, 'fake-acp-pool.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-acp-'));
const logOf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const turn = (cwd, env, prompt, resumeId) => new Promise((resolve) => {
  let text = '';
  runAcp({ command: process.execPath, args: [FAKE], cwd, env, prompt, mode: 'edit', resumeId, onEvent: (e) => { if (e.kind === 'text') text += e.text; } })
    .then((r) => resolve({ ...r, text }));
});

test.afterEach(() => acpPool.closeAll());

test('one agent process is reused across turns in the same folder', async () => {
  const cwd = tmp(); const log = path.join(cwd, 'log.jsonl'); const env = { ...process.env, FAKE_LOG: log };
  const a = await turn(cwd, env, 'one');
  const b = await turn(cwd, env, 'two', a.sessionId);
  assert.ok(a.ok && b.ok);
  assert.strictEqual(logOf(log).filter((x) => x.ev === 'spawn').length, 1);
  assert.strictEqual(b.sessionId, a.sessionId);
  assert.match(b.text, /^two#2@/);
  assert.strictEqual(acpPool.size(), 1);
});

test('the project .mcp.json servers are passed into new sessions, http only when supported', async () => {
  const cwd = tmp(); const log = path.join(cwd, 'log.jsonl');
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: {
    fs: { command: 'npx', args: ['-y', 'srv'], env: { ROOT: '/w' } },
    docs: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer T' } },
  } }));
  await turn(cwd, { ...process.env, FAKE_LOG: log }, 'hi');
  const created = logOf(log).find((x) => x.ev === 'new');
  assert.deepStrictEqual(created.mcpServers, [{ name: 'fs', command: 'npx', args: ['-y', 'srv'], env: [{ name: 'ROOT', value: '/w' }] }]);
  acpPool.closeAll();
  const log2 = path.join(cwd, 'log2.jsonl');
  await turn(cwd, { ...process.env, FAKE_LOG: log2, FAKE_HTTP: '1' }, 'hi');
  const created2 = logOf(log2).find((x) => x.ev === 'new');
  assert.deepStrictEqual(created2.mcpServers.map((s) => s.name).sort(), ['docs', 'fs']);
  assert.deepStrictEqual(created2.mcpServers.find((s) => s.name === 'docs'), { type: 'http', name: 'docs', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer T' }] });
});

test('a crashed agent is respawned and the session reloaded on the next turn', async () => {
  const cwd = tmp(); const log = path.join(cwd, 'log.jsonl'); const env = { ...process.env, FAKE_LOG: log };
  const a = await turn(cwd, env, 'one');
  const crash = await turn(cwd, env, 'CRASH', a.sessionId);
  assert.strictEqual(crash.ok, false);
  const c = await turn(cwd, env, 'three', a.sessionId);
  assert.ok(c.ok);
  const events = logOf(log);
  assert.strictEqual(events.filter((x) => x.ev === 'spawn').length, 2);
  assert.ok(events.find((x) => x.ev === 'load' && x.id === a.sessionId));
  assert.match(c.text, /^three#101@/);
});

test('idle agent processes are closed', async () => {
  const cwd = tmp(); const env = { ...process.env, FAKE_LOG: path.join(cwd, 'log.jsonl') };
  acpPool.idleMs = 50;
  try {
    await turn(cwd, env, 'one');
    assert.strictEqual(acpPool.size(), 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(acpPool.size(), 0);
  } finally { acpPool.idleMs = 10 * 60 * 1000; }
});
