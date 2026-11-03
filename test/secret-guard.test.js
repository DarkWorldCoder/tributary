'use strict';
require('./helpers/tmp').useCheckpointDir();
// Secrets stay out of merges, commits and transcripts: values from the project's .env files are recognised by
// name and value, well-known token shapes by pattern, and transcripts show [REDACTED] instead.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { SecretGuard } = require('../core/secret-guard');

// Built at run time so this file holds no token-shaped strings of its own.
const GITHUB = ['gh', 'p_', 'a1B2c3D4e5'.repeat(4)].join('');
const AWS = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
const TOKEN = 'tok_live_51Hq9secretvalue';

test('env files teach it secret values by name; ordinary settings are not secrets', () => {
  const g = new SecretGuard();
  g.addEnvText(`# local settings\nexport API_TOKEN="${TOKEN}"\nNODE_ENV=development\nPORT=3000\nDB_PASSWORD='hunter2hunter2'\nSHORT_KEY=abc\nDATABASE_URL=postgres://app:s3cretpass@localhost/app\nPUBLIC_NAME=Tributary Demo App\n`, '.env');
  assert.deepStrictEqual([...g.values.keys()].sort(), ['hunter2hunter2', 'postgres://app:s3cretpass@localhost/app', TOKEN].sort());
  assert.strictEqual(g.values.get(TOKEN), 'API_TOKEN from .env');
});

test('a diff is scanned only in added lines, naming the file and the kind, never the value', () => {
  const g = new SecretGuard(); g.addEnvText(`API_TOKEN=${TOKEN}\n`, '.env');
  const diff = [
    'diff --git a/app.js b/app.js', '--- a/app.js', '+++ b/app.js', '@@ -1,2 +1,3 @@', ` const old = "${TOKEN}";`, `-const gone = "${GITHUB}";`, `+const token = "${TOKEN}";`,
    'diff --git a/deploy/aws.ini b/deploy/aws.ini', 'new file mode 100644', '--- /dev/null', '+++ b/deploy/aws.ini', '@@ -0,0 +1 @@', `+key = ${AWS}`,
    'diff --git a/ci.yml b/ci.yml', '--- a/ci.yml', '+++ b/ci.yml', '@@ -1 +1 @@', `+gh: ${GITHUB}`,
  ].join('\n');
  const found = g.scanDiff(diff);
  assert.deepStrictEqual(found, [
    { file: 'app.js', kind: 'API_TOKEN from .env' },
    { file: 'deploy/aws.ini', kind: 'an AWS access key' },
    { file: 'ci.yml', kind: 'a GitHub token' },
  ]);
  assert.ok(!JSON.stringify(found).includes(TOKEN));
  assert.deepStrictEqual(g.scanDiff('+++ b/readme.md\n+Use process.env.API_TOKEN here\n'), []);
});

test('redaction replaces known values in text and in every string of an event', () => {
  const g = new SecretGuard(); g.addEnvText(`STRIPE_SECRET=${TOKEN}\n`, '.env');
  assert.strictEqual(g.redact(`the key is ${TOKEN}.`), 'the key is [REDACTED].');
  const e = { kind: 'tool', title: 'cat .env', output: `STRIPE_SECRET=${TOKEN}`, input: { command: `echo ${TOKEN}` }, files: [] };
  g.redactEvent(e);
  assert.strictEqual(e.output, 'STRIPE_SECRET=[REDACTED]'); assert.strictEqual(e.input.command, 'echo [REDACTED]');
  // A value split across two streamed pieces is caught once it is whole.
  assert.strictEqual(g.redactTail(`x ${TOKEN.slice(0, 10)}` + TOKEN.slice(10), TOKEN.length - 10), 'x [REDACTED]');
});

// A project with a gitignored .env, and a fake agent that runs a snippet of JavaScript in its folder.
const tmp = () => mkTmp('sg');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const agent = (id, code, say = "'done'") => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:${say}}})); console.log(JSON.stringify({type:'turn.completed'}));`] });
async function setup(agents) {
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, '.gitignore'), '.env\n'); fs.writeFileSync(path.join(d, 'app.js'), 'module.exports = 1;\n');
  sh(d, 'add', '.'); sh(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(d, '.env'), `API_TOKEN=${TOKEN}\n`);
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = agents;
  return { d, hub };
}

test('a merge that would commit a .env value is refused until you merge anyway, and the transcript never shows it', async () => {
  const leak = agent('leaky', "const v = fs.readFileSync('.env', 'utf8').trim().split('=')[1]; fs.writeFileSync('app.js', 'module.exports = ' + JSON.stringify(v) + ';\\n'); globalThis.v = v", "'I used ' + globalThis.v");
  const { d, hub } = await setup([leak]);
  const t = hub.createThread(d);
  await hub.createWorktree(t.id);
  const reply = await hub.send({ threadId: t.id, agentId: 'leaky', text: 'hardcode the token' });
  assert.strictEqual(reply.text, 'I used [REDACTED]');
  assert.ok(!JSON.stringify(hub.thread(t.id).messages).includes(TOKEN), 'nothing stored holds the value');
  await assert.rejects(hub.mergeWorktree(t.id), (e) => /looks like a secret/.test(e.message) && /API_TOKEN from \.env in app\.js/.test(e.message) && !e.message.includes(TOKEN));
  assert.strictEqual(fs.readFileSync(path.join(d, 'app.js'), 'utf8'), 'module.exports = 1;\n', 'nothing merged');
  const r = await hub.mergeWorktree(t.id, { allowSecrets: true });
  assert.deepStrictEqual(r.files, ['app.js']);
  hub.store.save(true);
});

test('Commit all in the project folder checks the changes too', async () => {
  const { d, hub } = await setup([]);
  hub.addProject(d);
  fs.writeFileSync(path.join(d, 'config.js'), `module.exports = { gh: '${GITHUB}' };\n`);
  await assert.rejects(hub.commit(d, 'add config'), /a GitHub token in config\.js/);
  assert.strictEqual(sh(d, 'rev-list', '--count', 'HEAD'), '1');
  await hub.commit(d, 'add config', { allowSecrets: true });
  assert.strictEqual(sh(d, 'rev-list', '--count', 'HEAD'), '2');
  hub.store.save(true);
});
