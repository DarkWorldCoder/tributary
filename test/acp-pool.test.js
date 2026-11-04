'use strict';
// ACP agents stay alive per agent and folder, get the project's MCP servers, respawn after a crash.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAcp, acpPool } = require('../core/acp');

const FAKE = path.join(__dirname, 'fake-acp-pool.js');
const tmp = () => mkTmp('acp');
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


test('structured tools keep command input and file locations across status-only updates', async () => {
  const cwd = tmp(); const events = [];
  const result = await runAcp({ command: process.execPath, args: [FAKE], cwd, env: { ...process.env, FAKE_LOG: path.join(cwd, 'log') }, prompt: 'TOOL_PATTERNS', mode: 'edit', onEvent: (event) => events.push(event) });
  assert.ok(result.ok);
  const command = events.findLast((event) => event.kind === 'tool' && event.id === 'command');
  assert.strictEqual(command.name, 'Bash');
  assert.strictEqual(command.input.command, 'printf hello; $(do-not-execute)');
  assert.strictEqual(command.output, 'hello');
  assert.strictEqual(command.files, undefined, 'a shell working directory is not a file edit');
  const file = events.findLast((event) => event.kind === 'tool' && event.id === 'file');
  assert.deepStrictEqual(file.files, [path.join(cwd, 'src/app.ts')]);
  assert.ok(events.some((event) => event.kind === 'file' && event.path === path.join(cwd, 'src/app.ts')));
});

test('Kimi running JSON arguments are parsed as input and completion JSON stays output', () => {
  const { normalizeAcpTool } = require('../core/acp-tools');
  const content = (text) => [{ type: 'content', content: { type: 'text', text } }];
  const initial = normalizeAcpTool({}, { title: 'Shell: printf hello', status: 'in_progress', content: content('{"command":') });
  assert.strictEqual(initial.name, 'Bash'); assert.ok(initial.argumentsContent); assert.strictEqual(initial.input, undefined);
  const running = normalizeAcpTool(initial.call, { content: content('{"command":"printf hello; $(never-run)"}'), status: 'in_progress' });
  assert.strictEqual(running.input.command, 'printf hello; $(never-run)');
  const done = normalizeAcpTool(running.call, { status: 'completed', content: content('{"result":"ok"}') });
  assert.strictEqual(done.input.command, 'printf hello; $(never-run)'); assert.strictEqual(done.argumentsContent, false);
  const structured = normalizeAcpTool({}, { name: 'task', kind: 'think', rawInput: { description: 'Review changes' } });
  assert.strictEqual(structured.name, 'background_agent');
  const unknown = normalizeAcpTool({}, { title: 'CustomTool', content: content('{"unexpected":true}'), status: 'in_progress' });
  assert.strictEqual(unknown.input, undefined);
});
