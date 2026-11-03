'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createCheckpoint, restoreCheckpoint } = require('../core/checkpoint');
const { listSkills, shareSkill } = require('../core/skills');
const { addArgs, removeArgs, redact, listMcp, addMcp, placeholder, codexLines, codexConfig } = require('../core/mcp');
const { listFiles, commitAll } = require('../core/git');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-feat-'));
const repo = () => {
  const d = tmp(); execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n'); fs.writeFileSync(path.join(d, '.gitignore'), 'secret.env\n');
  execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
  return d;
};

test('checkpoint restores edits, deletes new files, recreates deleted ones, ignores gitignored files', async () => {
  const d = repo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\nlocal edit before turn\n'); // uncommitted work survives
  fs.writeFileSync(path.join(d, 'keep.sh'), '#!/bin/sh\necho hi\n'); fs.chmodSync(path.join(d, 'keep.sh'), 0o755);
  const cp = await createCheckpoint(d, 'turn1');
  // the "agent" makes changes
  fs.writeFileSync(path.join(d, 'a.txt'), 'agent rewrote it\n');
  fs.writeFileSync(path.join(d, 'new.js'), 'console.log(1)\n');
  fs.rmSync(path.join(d, 'keep.sh'));
  fs.writeFileSync(path.join(d, 'secret.env'), 'TOKEN=1\n');
  const r = await restoreCheckpoint(d, cp);
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'one\nlocal edit before turn\n');
  assert.ok(!fs.existsSync(path.join(d, 'new.js')));
  assert.strictEqual(fs.statSync(path.join(d, 'keep.sh')).mode & 0o111, 0o111);
  assert.ok(fs.existsSync(path.join(d, 'secret.env')), 'ignored files are left alone');
  assert.deepStrictEqual(r, { restored: 2, removed: 1 });
  // user's real index and HEAD are untouched
  assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).split('\n').filter(Boolean).sort().join('|'), ' M a.txt|?? keep.sh');
  // Checkpoints live in Tributary's own store: no refs or new objects in the user's repository.
  assert.strictEqual(execFileSync('git', ['for-each-ref', 'refs/tributary'], { cwd: d, encoding: 'utf8' }).trim(), '');
  assert.throws(() => execFileSync('git', ['cat-file', '-e', cp], { cwd: d, stdio: 'ignore' }), 'checkpoint objects are not written into the repository');
});

test('listFiles honors .gitignore and includes untracked; commitAll commits everything', async () => {
  const d = repo(); fs.writeFileSync(path.join(d, 'secret.env'), 'x'); fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src', 'b.ts'), 'b');
  const files = await listFiles(d);
  assert.deepStrictEqual(files.sort(), ['.gitignore', 'a.txt', 'src/b.ts']);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const old = process.env; process.env = env;
  try { assert.match(await commitAll(d, 'Add b'), /Add b/); } finally { process.env = old; }
  assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).trim(), '?? secret.env'.replace('?? secret.env', ''));
});

test('skills: merges agents per skill and shares by symlink without overwriting', () => {
  const home = tmp();
  const mk = (dir, name, desc) => { const p = path.join(home, dir, name); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nbody`); };
  mk('.claude/skills', 'pdf', 'Read PDFs');
  mk('.codex/skills', 'pdf', 'Read PDFs');
  mk('.gemini/skills', 'slides', 'Make slides');
  fs.mkdirSync(path.join(home, '.claude/skills/not-a-skill'), { recursive: true });
  let s = listSkills({ home });
  assert.deepStrictEqual(s.map((x) => [x.name, x.agents.join(',')]), [['pdf', 'claude,codex'], ['slides', 'gemini']]);
  const created = shareSkill('slides', { home });
  assert.deepStrictEqual(created.map((c) => path.relative(home, c)).sort(), ['.agents/skills/slides', '.claude/skills/slides']);
  s = listSkills({ home });
  assert.deepStrictEqual(s.find((x) => x.name === 'slides').agents, ['antigravity', 'claude', 'codex', 'gemini']);
  assert.deepStrictEqual(shareSkill('slides', { home }), []);
  assert.throws(() => shareSkill('../etc', { home }), /Invalid/);
});

test('mcp: redact masks keys, tokens and header values', () => {
  const s = redact('npx -y mcp-remote https://x.example/mcp --header X-Goog-Api-Key: AQ.FAKE-test-key-0000000000 https://a.b/c?api_key=abc123&x=1 Authorization: Bearer sk-live-abcdefghijklmnop ghp_abcdefghijklmnopqrstu');
  assert.ok(!/AQ\.Ab8|abc123|sk-live|ghp_abc/.test(s), s);
  assert.match(s, /npx -y mcp-remote https:\/\/x\.example\/mcp/);
});

test('mcp: builds official CLI arguments per agent', () => {
  const stdio = { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work'], env: { ROOT: '/w' } };
  const http = { name: 'docs', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer T' } };
  assert.deepStrictEqual(addArgs('claude', stdio), ['mcp', 'add', '-s', 'user', '-t', 'stdio', 'fs', '-e', 'ROOT=${MCP_FS_ROOT}', '--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', '/work']);
  assert.deepStrictEqual(addArgs('claude', http), ['mcp', 'add', '-s', 'user', '-t', 'http', 'docs', '-H', 'Authorization: Bearer ${MCP_DOCS_AUTHORIZATION}', '--', 'https://example.com/mcp']);
  assert.deepStrictEqual(addArgs('codex', stdio), ['mcp', 'add', 'fs', '--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', '/work']);
  assert.deepStrictEqual(addArgs('codex', http), ['mcp', 'add', 'docs', '--url', 'https://example.com/mcp', '--bearer-token-env-var', 'MCP_DOCS_AUTHORIZATION']);
  assert.deepStrictEqual(addArgs('codex', { ...http, headers: {} }), ['mcp', 'add', 'docs', '--url', 'https://example.com/mcp']);
  assert.deepStrictEqual(addArgs('gemini', stdio), ['mcp', 'add', '-s', 'user', '-t', 'stdio', '--env=ROOT=$MCP_FS_ROOT', 'fs', 'npx', '--', '-y', '@modelcontextprotocol/server-filesystem', '/work']);
  assert.deepStrictEqual(addArgs('gemini', http), ['mcp', 'add', '-s', 'user', '-t', 'http', '--header=Authorization: Bearer $MCP_DOCS_AUTHORIZATION', 'docs', 'https://example.com/mcp']);
  assert.throws(() => addArgs('antigravity', stdio), /Antigravity has no documented way/);
  assert.deepStrictEqual(addArgs('antigravity', { ...stdio, env: {} }), ['mcp', 'add', 'fs', '--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', '/work']);
  assert.deepStrictEqual(addArgs('antigravity', { ...http, headers: {} }), ['mcp', 'add', '--type', 'http', 'docs', 'https://example.com/mcp']);
  assert.deepStrictEqual(removeArgs('gemini', 'fs'), ['mcp', 'remove', '-s', 'user', 'fs']);
});

// Fake values, long enough for the secret guard (8+ characters).
const MCP_TOKEN = 'ghp_' + 'f'.repeat(36); const MCP_KEY = 'key-value-12345'; const MCP_BEARER = 'tok-value-67890'; const MCP_HEADER = 'hdr-value-24680';
const mcpServers = () => [
  { name: 'gh', transport: 'stdio', command: 'gh-mcp', args: ['--stdio'], env: { GITHUB_TOKEN: MCP_TOKEN, API_KEY: MCP_KEY } },
  { name: 'docs', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${MCP_BEARER}`, 'X-Api-Key': MCP_HEADER } },
];

test('mcp: no env or header value ever reaches an agent\'s command line', () => {
  const values = [MCP_TOKEN, MCP_KEY, MCP_BEARER, MCP_HEADER];
  for (const agent of ['claude', 'codex', 'gemini']) {
    for (const s of mcpServers()) {
      const argv = addArgs(agent, s);
      for (const v of values) assert.ok(!argv.some((a) => a.includes(v)), `${agent} ${s.name}: ${JSON.stringify(argv)}`);
    }
  }
  for (const s of mcpServers()) assert.throws(() => addArgs('antigravity', s), (e) => /Antigravity/.test(e.message) && !values.some((v) => e.message.includes(v)));
});

test('mcp: placeholders use each agent\'s own syntax', () => {
  assert.strictEqual(placeholder('claude', 'MCP_GH_GITHUB_TOKEN'), '${MCP_GH_GITHUB_TOKEN}');
  assert.strictEqual(placeholder('gemini', 'MCP_GH_GITHUB_TOKEN'), '$MCP_GH_GITHUB_TOKEN');
  assert.strictEqual(placeholder('cursor-agent', 'MCP_GH_GITHUB_TOKEN'), '${env:MCP_GH_GITHUB_TOKEN}');
  assert.throws(() => placeholder('codex', 'X'), /no placeholder/);
  const [gh, docs] = mcpServers();
  assert.deepStrictEqual(addArgs('claude', gh).filter((a, i, all) => all[i - 1] === '-e'), ['GITHUB_TOKEN=${MCP_GH_GITHUB_TOKEN}', 'API_KEY=${MCP_GH_API_KEY}']);
  assert.deepStrictEqual(addArgs('claude', docs).filter((a, i, all) => all[i - 1] === '-H'), ['Authorization: Bearer ${MCP_DOCS_AUTHORIZATION}', 'X-Api-Key: ${MCP_DOCS_X_API_KEY}']);
  assert.deepStrictEqual(addArgs('gemini', gh).filter((a) => a.startsWith('--env=')), ['--env=GITHUB_TOKEN=$MCP_GH_GITHUB_TOKEN', '--env=API_KEY=$MCP_GH_API_KEY']);
  assert.deepStrictEqual(addArgs('gemini', docs).filter((a) => a.startsWith('--header=')), ['--header=Authorization: Bearer $MCP_DOCS_AUTHORIZATION', '--header=X-Api-Key: $MCP_DOCS_X_API_KEY']);
  // Codex: env_vars forward a stdio server's variables by their own name; HTTP headers name their variable
  assert.deepStrictEqual(codexLines(gh), ['env_vars = ["GITHUB_TOKEN", "API_KEY"]']);
  assert.deepStrictEqual(codexLines(docs), ['env_http_headers = { "X-Api-Key" = "MCP_DOCS_X_API_KEY" }']);
  const toml = '[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.gh]\ncommand = "gh-mcp"\nargs = ["--stdio"]\nenv_vars = ["OLD"]\n\n[mcp_servers.gh.env]\nA = "b"\n';
  assert.strictEqual(codexConfig(toml, 'gh', codexLines(gh)), '[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.gh]\nenv_vars = ["GITHUB_TOKEN", "API_KEY"]\ncommand = "gh-mcp"\nargs = ["--stdio"]\n\n[mcp_servers.gh.env]\nA = "b"\n');
  assert.match(codexConfig('[mcp_servers."a.b"]\nurl = "u"\n', 'a.b', ['env_vars = ["X"]']), /^\[mcp_servers\."a\.b"\]\nenv_vars = \["X"\]\nurl/);
  assert.strictEqual(codexConfig('[mcp_servers.other]\n', 'gh', ['env_vars = []']), null);
  assert.throws(() => addArgs('claude', { name: 'x', transport: 'stdio', command: 'c', env: { 'BAD NAME': 'v' } }), /not a valid environment variable name/);
});

test('mcp: values go to the secret store, each agent\'s turn gets them in its environment, and transcripts show [REDACTED]', async () => {
  const home = tmp(); const log = path.join(home, 'calls.log'); const codexHome = path.join(home, '.codex'); fs.mkdirSync(codexHome);
  const savedCodexHome = process.env.CODEX_HOME; process.env.CODEX_HOME = codexHome;
  try {
    const cli = (file, extra = '') => { fs.writeFileSync(file, `#!/usr/bin/env node\nconst a=process.argv.slice(2);require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a)+'\\n');${extra}console.log('Added');`); fs.chmodSync(file, 0o755); return file; };
    const fakeCli = cli(path.join(home, 'fake-cli.js'));
    const fakeCodex = cli(path.join(home, 'fake-codex.js'), `if(a[1]==='add')require('fs').appendFileSync(${JSON.stringify(path.join(codexHome, 'config.toml'))}, '[mcp_servers.'+a[2]+']\\ncommand = "x"\\n\\n');`);
    const d = repo();
    const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home }).init();
    hub.agents = ['claude', 'codex', 'gemini'].map((id) => ({ id, name: id, available: true, path: id === 'codex' ? fakeCodex : fakeCli }));
    for (const s of mcpServers()) assert.ok((await hub.addMcp(s)).every((r) => r.ok));

    const argv = fs.readFileSync(log, 'utf8');
    for (const v of [MCP_TOKEN, MCP_KEY, MCP_BEARER, MCP_HEADER]) assert.ok(!argv.includes(v), 'no value on a command line');
    assert.match(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'), /\[mcp_servers\.gh\]\nenv_vars = \["GITHUB_TOKEN", "API_KEY"\]\n/);
    assert.strictEqual(await hub.secrets.get('mcp:gh:MCP_GH_GITHUB_TOKEN'), MCP_TOKEN);
    assert.strictEqual(await hub.secrets.get('mcp:docs:MCP_DOCS_AUTHORIZATION'), MCP_BEARER, 'a bearer header keeps only the token');
    const index = JSON.stringify(hub.store.data.mcpSecrets);
    for (const v of [MCP_TOKEN, MCP_KEY, MCP_BEARER, MCP_HEADER]) assert.ok(!index.includes(v), 'the hub data holds names only');

    // A turn: the agent prints the variables it was given; the reply is redacted, the file shows what it saw.
    const seen = path.join(home, 'seen.json');
    const turnAgent = (id) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
      args: () => ['-e', `const e = process.env; const v = { scoped: e.MCP_GH_GITHUB_TOKEN || null, own: e.GITHUB_TOKEN === ${JSON.stringify(MCP_TOKEN)} ? e.GITHUB_TOKEN : null, bearer: e.MCP_DOCS_AUTHORIZATION || null, header: e.MCP_DOCS_X_API_KEY || null };
        require('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(v));
        console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'token ' + (v.scoped || v.own) + ' and bearer ' + v.bearer}})); console.log(JSON.stringify({type:'turn.completed'}));`] });
    hub.agents = [turnAgent('claude'), turnAgent('codex')];
    const t = hub.createThread(d);
    const claudeReply = await hub.send({ threadId: t.id, agentId: 'claude', text: 'show the token', mode: 'read' });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), { scoped: MCP_TOKEN, own: null, bearer: MCP_BEARER, header: MCP_HEADER }, 'Claude reads the server-named variables');
    assert.strictEqual(claudeReply.text, 'token [REDACTED] and bearer [REDACTED]');
    const codexReply = await hub.send({ threadId: t.id, agentId: 'codex', text: 'show the token', mode: 'read' });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), { scoped: null, own: MCP_TOKEN, bearer: MCP_BEARER, header: MCP_HEADER }, 'Codex env_vars read the variable by its own name');
    assert.strictEqual(codexReply.text, 'token [REDACTED] and bearer [REDACTED]');
    const stored = JSON.stringify(hub.thread(t.id).messages);
    for (const v of [MCP_TOKEN, MCP_BEARER]) assert.ok(!stored.includes(v), 'nothing stored holds a value');

    // Another server can't give Codex the same variable with a different value; Claude's are named per server.
    hub.agents = ['claude', 'codex'].map((id) => ({ id, name: id, available: true, path: id === 'codex' ? fakeCodex : fakeCli }));
    await assert.rejects(hub.addMcp({ name: 'gh2', transport: 'stdio', command: 'x', env: { GITHUB_TOKEN: 'another-token-value' } }, ['codex']), /gh2 and gh would both give codex the variable GITHUB_TOKEN/);
    assert.ok((await hub.addMcp({ name: 'gh2', transport: 'stdio', command: 'x', env: { GITHUB_TOKEN: 'another-token-value' } }, ['claude'])).every((r) => r.ok));

    // Removed from every agent, a server's values leave the secret store and later turns.
    for (const id of ['claude', 'codex', 'gemini']) { hub.agents = [{ id, name: id, available: true, path: fakeCli }]; await hub.removeMcp(id, 'gh'); }
    assert.strictEqual(await hub.secrets.get('mcp:gh:MCP_GH_GITHUB_TOKEN'), undefined);
    assert.strictEqual(hub.store.data.mcpSecrets.gh, undefined);
    assert.deepStrictEqual(Object.keys(await hub.mcpEnv('claude')).sort(), ['MCP_DOCS_AUTHORIZATION', 'MCP_DOCS_X_API_KEY', 'MCP_GH2_GITHUB_TOKEN']);
  } finally {
    if (savedCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedCodexHome;
  }
});

test('mcp: lists servers from each agent config with secrets masked, and adds via each CLI', async () => {
  const home = tmp(); const proj = tmp();
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', env: { TOKEN: 'ghp_abcdefghijklmnopqrstu' } } }, projects: { [proj]: { mcpServers: { local1: { type: 'http', url: 'https://l/mcp?key=SECRETKEY123' } } } } }));
  fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { g1: { httpUrl: 'https://g/mcp' } } }));
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { stitch: { command: 'npx', args: ['mcp-remote', 'https://s/mcp', '--header', 'X-Goog-Api-Key: AQ.SECRETSECRETSECRET'] } } }));
  // fake codex that prints `mcp list --json`, and records add calls
  const log = path.join(home, 'calls.log');
  const fake = path.join(home, 'fake-cli.js');
  fs.writeFileSync(fake, `#!/usr/bin/env node\nconst a=process.argv.slice(2);require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a)+'\\n');if(a[0]==='mcp'&&a[1]==='list')console.log(JSON.stringify([{name:'Figma',enabled:true,transport:{type:'streamable_http',url:'https://figma/mcp'}}]));else console.log('Added');`);
  fs.chmodSync(fake, 0o755);
  const agents = ['claude', 'codex', 'gemini', 'antigravity'].map((id) => ({ id, available: true, path: fake }));
  const list = await listMcp({ agents, home, project: proj });
  assert.deepStrictEqual(list.map((s) => `${s.agent}:${s.name}:${s.scope}`).sort(), ['antigravity:stitch:user', 'claude:gh:user', 'claude:local1:local', 'codex:Figma:user', 'gemini:g1:user']);
  const text = JSON.stringify(list);
  assert.ok(!/SECRET|ghp_/.test(text), text);
  assert.deepStrictEqual(list.find((s) => s.name === 'gh').envKeys, ['TOKEN']);
  const res = await addMcp({ agents, server: { name: 'fs', transport: 'stdio', command: 'npx', args: ['srv'] } });
  assert.deepStrictEqual(res.map((r) => r.ok), [true, true, true, true]);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a[1] === 'add');
  assert.strictEqual(calls.length, 4);
  await assert.rejects(addMcp({ agents, server: { name: 'bad name', transport: 'stdio', command: 'x' } }), /letters/);
});

test('hub: plan mode forces read-only and approval passes the plan to the next agent; checkpoints restore', async () => {
  const FAKE = path.join(__dirname, 'fake-agent.js');
  const d = repo();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  const fakeAgent = (id, proto) => ({ id, name: `Fake ${id}`, protocol: proto, available: true, path: process.execPath, stdinPrompt: true, args: ({ resumeId, mode }) => [FAKE, proto, ...(resumeId ? ['--resume', resumeId] : []), `--mode=${mode}`] });
  hub.agents = [fakeAgent('claude', 'claude-stream'), fakeAgent('codex', 'codex-exec')];
  const t = hub.createThread(d);
  const p = await hub.send({ threadId: t.id, agentId: 'claude', text: 'add caching', mode: 'full', plan: true });
  assert.strictEqual(p.mode, 'read'); assert.strictEqual(p.kind, 'plan'); assert.ok(p.checkpoint, 'every turn gets a checkpoint so its diff can be shown');
  assert.match(p.text, /Plan only\. Do not modify files/);
  const impl = await hub.send({ threadId: t.id, agentId: 'codex', text: '', mode: 'edit', planFrom: p.id });
  assert.strictEqual(impl.kind, 'implement');
  assert.match(impl.text, /Implement this plan[\s\S]*## Plan\nECHO:Plan only/);
  assert.ok(impl.checkpoint, 'edit turns get a checkpoint');
  // fake codex created b.txt in the project; restore removes it
  fs.writeFileSync(path.join(d, 'b.txt'), 'made by agent');
  const r = await hub.restoreCheckpoint(t.id, impl.id);
  assert.ok(!fs.existsSync(path.join(d, 'b.txt')));
  assert.strictEqual(r.removed, 1);
  assert.match(hub.thread(t.id).messages.find((m) => m.id === impl.id).notices.join(' '), /Files restored/);
});

// ---------- teams, memory, per-turn diffs, notifications, files, export
const { verdict } = require('../core/teams');
const FAKE_SCRIPTED = path.join(__dirname, 'fake-scripted.js');

function scriptedHub(dir, script) {
  // script: agentId -> array of reply texts, consumed in order; writes files named in "WRITE:<file>" markers.
  fs.writeFileSync(FAKE_SCRIPTED, `#!/usr/bin/env node
const fs=require('fs');const [stateFile, id]=process.argv.slice(2);
let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
  const st=JSON.parse(fs.readFileSync(stateFile,'utf8')); const reply=(st[id]||[]).shift()||'ok'; fs.writeFileSync(stateFile, JSON.stringify(st));
  fs.appendFileSync(stateFile+'.prompts', JSON.stringify({id, prompt:s})+'\\n');
  const m=/WRITE:(\\S+)/.exec(reply); if(m) fs.appendFileSync(m[1], id+'\\n');
  const out=o=>process.stdout.write(JSON.stringify(o)+'\\n');
  out({type:'thread.started',thread_id:id+'-sess'}); out({type:'item.completed',item:{id:'i',type:'agent_message',text:reply}}); out({type:'turn.completed',usage:{}});
});`);
  const state = path.join(tmp(), 'state.json'); fs.writeFileSync(state, JSON.stringify(script));
  const mk = (id) => ({ id, name: id[0].toUpperCase() + id.slice(1), protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true, args: () => [FAKE_SCRIPTED, state, id] });
  return { mk, state };
}

test('teams: verdict parsing', () => {
  assert.strictEqual(verdict('looks good\nVERDICT: APPROVED'), 'approved');
  assert.strictEqual(verdict('two bugs\nVERDICT: CHANGES REQUESTED'), 'changes');
  assert.strictEqual(verdict('no verdict'), 'unknown');
});

test('teams: build and review loops until the reviewer approves, then notifies', async () => {
  const d = repo();
  const { mk, state } = scriptedHub(d, { builder: ['built WRITE:out.txt', 'fixed WRITE:out.txt'], reviewer: ['missing test\nVERDICT: CHANGES REQUESTED', 'all good\nVERDICT: APPROVED'] });
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [mk('builder'), mk('reviewer')];
  const t = hub.createThread(d);
  const prevCwd = process.cwd(); process.chdir(d);
  let r; try { r = await hub.runTeam(t.id, { recipe: 'build-review', task: 'make out.txt', roles: { builder: 'builder', reviewer: 'reviewer' } }); } finally { process.chdir(prevCwd); }
  assert.deepStrictEqual(r, { verdict: 'approved', rounds: 1 });
  const roles = hub.thread(t.id).messages.filter((m) => m.role === 'assistant').map((m) => `${m.agent}:${m.team.role}:${m.mode}`);
  assert.deepStrictEqual(roles, ['builder:builder:edit', 'reviewer:reviewer:read', 'builder:builder:edit', 'reviewer:reviewer:read']);
  const prompts = fs.readFileSync(`${state}.prompts`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.match(prompts[2].prompt, /Since your last reply[\s\S]*missing test[\s\S]*Address every problem/);
  const n = hub.notifications()[0];
  assert.match(n.title, /Build and review finished/); assert.strictEqual(n.kind, 'done');
  assert.strictEqual(hub.state().unread, 1);
  hub.markRead(); assert.strictEqual(hub.state().unread, 0);
});

test('teams: ask everyone runs members read-only, then the summarizer; validation errors', async () => {
  const d = repo();
  const { mk } = scriptedHub(d, { a: ['A says X'], b: ['B says Y'], c: ['combined'] });
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [mk('a'), mk('b'), mk('c')];
  const t = hub.createThread(d);
  await hub.runTeam(t.id, { recipe: 'council', task: 'which db?', roles: { members: ['a', 'b'], synthesizer: 'c' } });
  const ms = hub.thread(t.id).messages.filter((m) => m.role === 'assistant');
  assert.deepStrictEqual(ms.map((m) => `${m.agent}:${m.mode}`), ['a:read', 'b:read', 'c:read']);
  await assert.rejects(hub.runTeam(t.id, { recipe: 'council', task: 'x', roles: { members: ['a'], synthesizer: 'c' } }), /at least two/);
  await assert.rejects(hub.runTeam(t.id, { recipe: 'build-review', task: '  ', roles: {} }), /Describe the task/);
});

test('memory: enable, remember, work log after each turn, AGENTS.md pointer added once', async () => {
  const d = repo();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.addProject(d);
  const created = hub.enableMemory(d);
  assert.ok(created.includes('.tributary/memory.md') && created.includes('AGENTS.md'));
  assert.deepStrictEqual(hub.enableMemory(d), []);
  assert.strictEqual((fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8').match(/tributary:memory/g) || []).length, 1);
  assert.strictEqual(fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  hub.remember(d, 'Use pnpm, not npm');
  const { mk } = scriptedHub(d, { w: ['done WRITE:' + path.join(d, 'z.txt')] });
  hub.agents = [mk('w')];
  const t = hub.createThread(d);
  await hub.send({ threadId: t.id, agentId: 'w', text: 'make z' });
  const mem = hub.memory(d);
  assert.match(mem.memory, /- Use pnpm, not npm/);
  assert.strictEqual(mem.worklog.length, 1);
  assert.match(mem.worklog[0], /W: "make z"\. Changed `z\.txt`/);
});

test('turnDiff shows only what one turn changed; threadChanges indexes files by turn', async () => {
  const d = repo();
  const { mk } = scriptedHub(d, { a: ['WRITE:' + path.join(d, 'a.txt')], b: ['WRITE:' + path.join(d, 'b.txt')] });
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [mk('a'), mk('b')];
  const t = hub.createThread(d);
  const m1 = await hub.send({ threadId: t.id, agentId: 'a', text: 'one' });
  const m2 = await hub.send({ threadId: t.id, agentId: 'b', text: 'two' });
  const d1 = await hub.turnDiff(t.id, m1.id); const d2 = await hub.turnDiff(t.id, m2.id);
  assert.match(d1, /a\.txt/); assert.doesNotMatch(d1, /b\.txt/);
  assert.match(d2, /b\.txt/); assert.doesNotMatch(d2, /a\.txt/);
  assert.match(await hub.turnDiff(t.id, m1.id, 'a.txt'), /\+a/);
  assert.deepStrictEqual(hub.threadChanges(t.id).map((c) => `${c.rel}:${c.turns.map((x) => x.agent).join(',')}`).sort(), ['a.txt:a', 'b.txt:b']);
});

test('readFile: text, binary, truncation and containment; export to markdown', async () => {
  const d = repo();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.addProject(d);
  fs.writeFileSync(path.join(d, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  assert.strictEqual((await hub.readFile(d, 'a.txt')).content, 'one\n');
  assert.strictEqual((await hub.readFile(d, 'img.bin')).binary, true);
  await assert.rejects(hub.readFile(d, '../../etc/passwd'), /outside/);
  const t = hub.createThread(d); t.messages.push({ role: 'user', text: 'hi', target: 'claude' }, { role: 'assistant', agent: 'claude', text: 'hello', tools: [{ name: 'shell', input: { command: 'ls' }, status: 'done' }], files: [{ rel: 'a.txt' }] });
  const md = hub.exportMarkdown(t.id);
  assert.match(md, /^# New thread/); assert.match(md, /- shell ls/); assert.match(md, /Changed files: `a\.txt`/);
});
