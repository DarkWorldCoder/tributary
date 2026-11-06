'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createParser } = require('../core/parsers');
const { plan } = require('../core/handoff');
const { gatewayLaunch, supports } = require('../core/gateways');
const { runTurn } = require('../core/runner');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { detectAgents } = require('../core/agents');

const FIX = path.join(__dirname, 'fixtures');
const FAKE = path.join(__dirname, 'fake-agent.js');
const FAKE_ACP = path.join(__dirname, 'fake-acp.js');
const parse = (proto, file) => { const p = createParser(proto); return fs.readFileSync(path.join(FIX, file), 'utf8').split('\n').flatMap((l) => p.line(l)); };
const textOf = (ev) => ev.filter((e) => e.kind === 'text').map((e) => e.text).join('');
const tmp = () => mkTmp('test');
const fakeAgent = (id, proto, extra = []) => ({
  id, name: `Fake ${id}`, protocol: proto, available: true, path: process.execPath, stdinPrompt: true, gateways: ['openai', 'anthropic'],
  args: ({ resumeId }) => [FAKE, proto, ...(resumeId ? ['--resume', resumeId] : []), ...extra],
});

test('agent discovery can find installed agents without launching version probes', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp();
  const marker = path.join(dir, 'probed');
  const binary = path.join(dir, 'agent');
  const customFile = path.join(dir, 'agents.json');
  fs.writeFileSync(binary, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); console.log('v1.2.3');\n`, { mode: 0o755 });
  fs.writeFileSync(customFile, JSON.stringify({ agents: [{ id: 'startup-test', name: 'Startup test', command: binary, args: [] }] }));
  try {
    const agents = await detectAgents({ customFile, probeVersions: false });
    const agent = agents.find((a) => a.id === 'startup-test');
    assert.strictEqual(agent.available, true);
    assert.strictEqual(agent.version, null);
    assert.strictEqual(fs.existsSync(marker), false, 'discovery must not execute the agent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub publishes usable agents before version probes finish and shares concurrent scans', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp();
  const binary = path.join(dir, 'agent');
  fs.writeFileSync(binary, `#!${process.execPath}\nsetTimeout(() => console.log('v1.2.3'), 200);\n`, { mode: 0o755 });
  const hub = new Hub({ dataDir: dir, secrets: new MemorySecrets(), home: dir });
  fs.writeFileSync(hub.customAgentsFile, JSON.stringify({ agents: [{ id: 'startup-test', name: 'Startup test', command: binary, args: [] }] }));
  const states = [];
  hub.on('state', () => states.push(hub.state()));
  try {
    const first = hub.rescan();
    assert.strictEqual(hub.rescan(), first, 'overlapping scans must share one operation');
    const agents = await first;
    assert.ok(states.some((s) => s.scanningAgents && s.agents.some((a) => a.id === 'startup-test' && a.available && a.version === null)), 'installed agent is published while version probing continues');
    assert.strictEqual(agents.find((a) => a.id === 'startup-test').version, 'v1.2.3');
    assert.strictEqual(states.at(-1).scanningAgents, false);
    assert.strictEqual(hub.agentScan, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('parses real Claude Code stream', () => {
  const ev = parse('claude-stream', 'claude.jsonl');
  assert.strictEqual(textOf(ev), 'OK');
  assert.ok(ev.find((e) => e.kind === 'session' && /^[0-9a-f-]{36}$/.test(e.sessionId)));
  assert.deepStrictEqual(ev.filter((e) => e.kind === 'done').map((e) => e.ok), [true]);
});
test('parses real Codex exec stream', () => {
  const ev = parse('codex-exec', 'codex.jsonl');
  assert.strictEqual(textOf(ev), 'OK');
  assert.ok(ev.find((e) => e.kind === 'session'));
  assert.ok(ev.find((e) => e.kind === 'done' && e.ok));
});
test('parses real Antigravity stream', () => {
  const ev = parse('agy-stream', 'agy.jsonl');
  assert.strictEqual(textOf(ev).trim(), 'OK');
  const tools = ev.filter((e) => e.kind === 'tool');
  assert.deepStrictEqual(tools.map((t) => t.status), ['running', 'done']);
  assert.ok(ev.find((e) => e.kind === 'file' && e.path.endsWith('implementation_plan.md')));
});
test('parses Gemini CLI stream schema', () => {
  const ev = parse('gemini-stream', 'gemini.jsonl');
  assert.strictEqual(textOf(ev), 'Fixed the typo.');
  assert.ok(ev.find((e) => e.kind === 'file' && e.path === '/project/README.md'));
  assert.ok(ev.find((e) => e.kind === 'tool' && e.status === 'done'));
});
test('ignores non-JSON noise lines', () => {
  assert.deepStrictEqual(createParser('codex-exec').line('Reading additional input from stdin...'), []);
});

test('handoff: same agent resumes without preamble', () => {
  const thread = { messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', agent: 'claude', text: 'hello' }], agentSessions: { claude: 's1' } };
  const p = plan({ thread, agentId: 'claude', text: 'next' });
  assert.deepStrictEqual([p.kind, p.resumeId, p.prompt], ['resume', 's1', 'next']);
});
test('handoff: new agent gets digest of thread and git state', () => {
  const thread = { messages: [{ role: 'user', text: 'build login' }, { role: 'assistant', agent: 'claude', text: 'done', tools: [{ name: 'Edit', files: ['login.js'] }] }], agentSessions: { claude: 's1' } };
  const p = plan({ thread, agentId: 'codex', text: 'add tests', names: { claude: 'Claude Code' }, git: { branch: 'main', changed: [{ code: 'M', path: 'login.js' }] } });
  assert.strictEqual(p.kind, 'join');
  assert.strictEqual(p.resumeId, null);
  for (const s of ['build login', '### Claude Code', 'edited: login.js', 'M  login.js', '## Current request\nadd tests']) assert.ok(p.prompt.includes(s), s);
});
test('handoff: returning agent gets only what happened since', () => {
  const thread = { messages: [
    { role: 'user', text: 'one' }, { role: 'assistant', agent: 'claude', text: 'first' },
    { role: 'user', text: 'two' }, { role: 'assistant', agent: 'codex', text: 'codex did stuff' }], agentSessions: { claude: 's1', codex: 'c1' } };
  const p = plan({ thread, agentId: 'claude', text: 'three', names: { codex: 'Codex' } });
  assert.strictEqual(p.kind, 'catch-up');
  assert.strictEqual(p.resumeId, 's1');
  assert.ok(p.prompt.includes('codex did stuff') && !p.prompt.includes('### User\none'));
});
test('handoff digest stays within budget', () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', agent: 'claude', text: 'x'.repeat(1000) + i }));
  const p = plan({ thread: { messages, agentSessions: {} }, agentId: 'codex', text: 'go' });
  assert.ok(p.prompt.length < 16000, String(p.prompt.length));
  assert.ok(p.prompt.includes('earlier messages omitted'));
});

test('gateway: Claude Code gets Anthropic env, Codex gets provider config', () => {
  const g = { name: 'gw', protocol: 'anthropic', baseUrl: 'http://localhost:4000', model: 'deepseek-chat', apiKey: 'k' };
  const c = gatewayLaunch({ id: 'claude', name: 'Claude Code', gateways: ['anthropic'] }, g);
  assert.strictEqual(c.env.ANTHROPIC_BASE_URL, 'http://localhost:4000');
  assert.strictEqual(c.env.ANTHROPIC_AUTH_TOKEN, 'k');
  assert.strictEqual(c.env.ANTHROPIC_API_KEY, null);
  assert.strictEqual(c.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-chat');
  const o = gatewayLaunch({ id: 'codex', name: 'Codex', gateways: ['openai', 'ollama'] }, { protocol: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'z', wireApi: 'chat' });
  assert.ok(o.args.includes('model_providers.tributary.base_url="http://localhost:11434/v1"'));
  assert.ok(o.args.includes('model_provider="tributary"'));
  assert.strictEqual(o.env.TRIBUTARY_API_KEY, 'z');
  const oss = gatewayLaunch({ id: 'codex', name: 'Codex', gateways: ['ollama'] }, { protocol: 'ollama', model: 'gpt-oss:20b' });
  assert.deepStrictEqual(oss.args, ['--oss', '--local-provider', 'ollama']);
  assert.strictEqual(supports({ gateways: ['openai'] }, g), false);
  assert.throws(() => gatewayLaunch({ id: 'codex', name: 'Codex', gateways: ['openai'] }, g), /can't use/);
});

test('runner: streams a fake Claude-style agent from stdin, with file events', async () => {
  const cwd = tmp(); const ev = [];
  const r = await runTurn({ agent: fakeAgent('claude', 'claude-stream'), cwd, prompt: 'hello world', mode: 'edit', onEvent: (e) => ev.push(e) });
  assert.ok(r.ok);
  assert.strictEqual(r.text, 'ECHO:hello world');
  assert.ok(r.sessionId.startsWith('sess-'));
  assert.ok(ev.find((e) => e.kind === 'file' && e.path === path.join(cwd, 'a.txt')));
});
test('runner: surfaces stderr when an agent fails', async () => {
  const ev = [];
  const r = await runTurn({ agent: fakeAgent('x', 'codex-exec', ['--fail']), cwd: tmp(), prompt: 'p', onEvent: (e) => ev.push(e) });
  assert.strictEqual(r.ok, false);
  assert.ok(ev.find((e) => e.kind === 'error' && /simulated failure/.test(e.message)));
});
test('runner: stop kills a hung agent', async () => {
  const ac = new AbortController(); const ev = [];
  setTimeout(() => ac.abort(), 300);
  const t0 = Date.now();
  const r = await runTurn({ agent: fakeAgent('x', 'codex-exec', ['--hang']), cwd: tmp(), prompt: 'p', onEvent: (e) => ev.push(e), signal: ac.signal });
  assert.strictEqual(r.ok, false);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(ev.find((e) => e.kind === 'notice' && /Stopped/.test(e.text)));
});
test('runner: unavailable agent reports cleanly', async () => {
  const ev = [];
  const r = await runTurn({ agent: { name: 'Nope', available: false }, cwd: tmp(), prompt: 'p', onEvent: (e) => ev.push(e) });
  assert.strictEqual(r.ok, false);
  assert.ok(ev.find((e) => e.kind === 'error' && /not installed/.test(e.message)));
});

test('ACP: edit mode allows project writes, blocks writes outside the project', async () => {
  const cwd = tmp(); const ev = [];
  const agent = { id: 'acp', name: 'Fake ACP', protocol: 'acp', available: true, path: process.execPath, acpArgs: [FAKE_ACP] };
  const r = await runTurn({ agent, cwd, prompt: 'hi', mode: 'edit', onEvent: (e) => ev.push(e) });
  assert.ok(r.ok, JSON.stringify(ev));
  assert.strictEqual(r.sessionId, 'acp-1');
  assert.strictEqual(fs.readFileSync(path.join(cwd, 'notes.md'), 'utf8'), 'from acp\n');
  assert.strictEqual(textOf(ev), 'ECHO:hi|outside:blocked');
  assert.ok(!fs.existsSync('/etc/tributary-should-not-exist'));
});
test('ACP: read-only mode rejects the edit', async () => {
  const cwd = tmp(); const ev = [];
  const agent = { id: 'acp', name: 'Fake ACP', protocol: 'acp', available: true, path: process.execPath, acpArgs: [FAKE_ACP] };
  await runTurn({ agent, cwd, prompt: 'hi', mode: 'read', onEvent: (e) => ev.push(e) });
  assert.ok(!fs.existsSync(path.join(cwd, 'notes.md')));
  assert.ok(ev.find((e) => e.kind === 'notice' && /Declined/.test(e.text)));
});

test('hub: two agents share one thread with handoff, sessions resume, keys stay out of the data files', async () => {
  const dataDir = tmp(); const proj = tmp();
  const hub = new Hub({ dataDir, secrets: new MemorySecrets() });
  await hub.init();
  hub.agents = [fakeAgent('claude', 'claude-stream'), fakeAgent('codex', 'codex-exec')];
  hub.addProject(proj);
  const t = hub.createThread(proj);
  const m1 = await hub.send({ threadId: t.id, agentId: 'claude', text: 'build it', mode: 'edit' });
  assert.strictEqual(m1.text, 'ECHO:build it');
  assert.strictEqual(m1.handoff, 'new');
  const m2 = await hub.send({ threadId: t.id, agentId: 'codex', text: 'review it', mode: 'read' });
  assert.strictEqual(m2.handoff, 'join');
  assert.ok(m2.text.includes('### Fake claude') && m2.text.includes('ECHO:build it') && m2.text.includes('## Current request\nreview it'));
  assert.deepStrictEqual(m2.files.map((f) => f.rel), ['b.txt']);
  const m3 = await hub.send({ threadId: t.id, agentId: 'claude', text: 'fix it' });
  assert.strictEqual(m3.handoff, 'catch-up');
  assert.ok(m3.resumed);
  const thread = hub.thread(t.id);
  assert.strictEqual(thread.title, 'build it');
  assert.strictEqual(thread.messages.length, 6);
  const gid = await hub.saveGateway({ name: 'Local', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', apiKey: 'sk-secret-123' });
  hub.store.save(true);
  for (const f of fs.readdirSync(dataDir).filter((x) => x.startsWith('tributary.db'))) assert.ok(!fs.readFileSync(path.join(dataDir, f)).includes('sk-secret-123'), f);
  assert.strictEqual((await hub.resolveGateway(gid)).apiKey, 'sk-secret-123');
  await assert.rejects(hub.send({ threadId: t.id, agentId: 'claude', text: 'x', gatewayId: (await hub.saveGateway({ name: 'G', protocol: 'gemini' })) }), /can't use/);
  assert.deepStrictEqual(hub.syncInstructions(proj).sort(), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  assert.deepStrictEqual(hub.syncInstructions(proj), []);
});

test('hub: detects files changed by shell commands via git', async () => {
  const { execFileSync } = require('child_process');
  const proj = tmp();
  execFileSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'keep.txt'), 'x\n'); fs.writeFileSync(path.join(proj, 'dirty.txt'), 'old\n');
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'dirty.txt'), 'dirty before turn\n'); // already dirty, untouched by the turn
  const script = path.join(proj, '..', `shell-agent-${Date.now()}.js`);
  fs.writeFileSync(script, "require('fs').appendFileSync('keep.txt','more\\n');require('fs').writeFileSync('new.txt','n');console.log(JSON.stringify({type:'turn.completed'}))");
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets() }).init();
  hub.agents = [{ id: 'sh', name: 'Shell', protocol: 'codex-exec', available: true, path: process.execPath, args: () => [script] }];
  const t = hub.createThread(proj);
  const m = await hub.send({ threadId: t.id, agentId: 'sh', text: 'go' });
  assert.deepStrictEqual(m.files.map((f) => f.rel).sort(), ['keep.txt', 'new.txt']);
  assert.match(await hub.fileDiff(proj, 'keep.txt'), /\+more/);
  assert.match(await hub.fileDiff(proj, 'new.txt'), /^new file new.txt/);
});

test('hub: the request appears before the checkpoint, which is still taken before the agent runs', async () => {
  const { execFileSync } = require('child_process');
  const proj = tmp();
  execFileSync('git', ['init', '-q'], { cwd: proj }); fs.writeFileSync(path.join(proj, 'a.txt'), 'x\n');
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: proj });
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets() });
  hub.agents = [fakeAgent('claude', 'claude-stream')];
  const t = hub.createThread(proj);
  const shown = [];
  hub.on('message', ({ message }) => { if (message.role === 'assistant') shown.push(message.checkpoint || null); });
  const m = await hub.send({ threadId: t.id, agentId: 'claude', text: 'go' });
  assert.strictEqual(shown[0], null, 'the reply placeholder is shown without waiting for the checkpoint');
  assert.ok(m.checkpoint && shown.includes(m.checkpoint), 'the checkpoint is attached once it exists');
  assert.match(await hub.turnDiff(t.id, m.id), /a\.txt|^$/, 'the turn can still be diffed against its checkpoint');
  hub.store.save(true);
});

test('custom agents can use a streaming protocol: their args list gets {prompt}, {cwd} and {mode}', async () => {
  const dir = tmp(); const file = path.join(dir, 'agents.json');
  const script = path.join(dir, 'agent.js');
  fs.writeFileSync(script, "const [p, cwd, mode] = process.argv.slice(2); console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: `got ${p} in ${require('path').basename(cwd)} as ${mode}` } })); console.log(JSON.stringify({ type: 'turn.completed' }));");
  fs.writeFileSync(file, JSON.stringify({ agents: [{ id: 'mine', name: 'Mine', command: process.execPath, args: [script, '{prompt}', '{cwd}', '{mode}'], protocol: 'codex-exec' }] }));
  const [agent] = (await detectAgents({ customFile: file, probeVersions: false })).filter((a) => a.id === 'mine');
  const cwd = tmp(); const ev = [];
  const r = await runTurn({ agent, cwd, prompt: 'hello', mode: 'read', onEvent: (e) => ev.push(e) });
  assert.strictEqual(r.ok, true, JSON.stringify(ev));
  assert.strictEqual(textOf(ev), `got hello in ${path.basename(cwd)} as read`);
});

test('version probes run once per binary and two at a time', { skip: process.platform === 'win32' }, async () => {
  const { probeVersions } = require('../core/agents');
  const dir = tmp(); const log = path.join(dir, 'log'); const ready = path.join(dir, 'two-started');
  const bin = (name) => {
    const p = path.join(dir, name);
    // Keep the first pair alive until both processes have actually started.
    // A fixed sleep can finish before the second Node process is scheduled.
    fs.writeFileSync(p, `#!${process.execPath}\nconst fs=require('fs');const log=${JSON.stringify(log)},ready=${JSON.stringify(ready)};fs.appendFileSync(log, 'start ${name}\\n');function finish(){if(!fs.existsSync(ready)){if(fs.readFileSync(log,'utf8').split('\\n').filter(l=>l.startsWith('start ')).length<2){setTimeout(finish,5);return;}fs.writeFileSync(ready,'ready');}fs.appendFileSync(log,'end ${name}\\n');console.log('${name} 1.0.0');}finish();\n`, { mode: 0o755 });
    return p;
  };
  const shared = bin('shared'); const one = bin('one'); const two = bin('two');
  const customFile = path.join(dir, 'agents.json');
  fs.writeFileSync(customFile, JSON.stringify({ agents: [
    { id: 'a', name: 'A', command: shared, args: [] }, { id: 'b', name: 'B', command: shared, args: [] },
    { id: 'c', name: 'C', command: one, args: [] }, { id: 'd', name: 'D', command: two, args: [] }] }));
  const found = (await detectAgents({ customFile, probeVersions: false, env: { PATH: '' } })).filter((a) => a.custom);
  const probed = await probeVersions(found, { concurrency: 2 });
  assert.deepStrictEqual(probed.map((a) => a.version), ['shared 1.0.0', 'shared 1.0.0', 'one 1.0.0', 'two 1.0.0']);
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.strictEqual(lines.filter((l) => l === 'start shared').length, 1, 'a binary shared by two agents is probed once');
  let running = 0; let most = 0;
  for (const l of lines) { running += l.startsWith('start') ? 1 : -1; most = Math.max(most, running); }
  assert.strictEqual(most, 2, lines.join(', '));
});
