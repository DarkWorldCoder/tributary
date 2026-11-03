'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Team secrets: a SOPS-encrypted dotenv file in the repository, one age key per member. Values reach agents and
// terminals only through their environment, transcripts redact them, and a removed member loses access to the
// rotated file. The SOPS tests need the sops binary and are skipped without it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { SecretGuard } = require('../core/secret-guard');
const { which } = require('../core/agents');
const { TeamSecrets, parseMembers, configText, parseDotenv, dotenvText, describeFile, FILE, CONFIG } = require('../core/team-secrets');
const { createService } = require('../server/service');

const skip = !which('sops', process.env) && 'sops is not installed (https://getsops.io/docs/)';
// Built at run time so this file holds no token-shaped strings of its own; none of these are real secrets.
const TOKEN = ['tok', 'team', 'Q7wP2xL9vR4nK8sT'].join('_');
const URL = `https://hooks.example.test/${'c3VwZXJzZWNyZXQ'.repeat(2)}`;
const CERT = ['line one of a test value', 'line two'].join('\n');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-ts-'));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'app.js'), 'module.exports = 1;\n');
  sh(d, 'add', '.'); sh(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return d;
}
// One teammate: their own secret store (so their own age key) and secret guard.
const member = () => { const guard = new SecretGuard(); return { guard, team: new TeamSecrets(new MemorySecrets(), guard) }; };

test('.sops.yaml lists one age key per member, named by its comment; the encrypted file shows names, not values', () => {
  const a = `age1${'q'.repeat(58)}`; const b = `age1${'p'.repeat(58)}`;
  const text = configText([{ recipient: a, name: 'Ana # lead' }, { recipient: b, name: '' }]);
  assert.match(text, /^# Team secrets for Tributary\./);
  assert.deepStrictEqual(parseMembers(text), [{ recipient: a, name: 'Ana lead' }, { recipient: b, name: '' }]);
  // A hand-written config with comma-separated keys still lists its members.
  assert.deepStrictEqual(parseMembers(`creation_rules:\n  - age: >-\n      ${a},\n      ${b}\n`).map((m) => m.recipient), [a, b]);
  assert.deepStrictEqual(parseDotenv(dotenvText({ CERT, TOKEN })), { CERT, TOKEN });
  const file = `API_TOKEN=ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]\nsops_age__list_0__map_recipient=${a}\nsops_age__list_0__map_enc=-----BEGIN AGE ENCRYPTED FILE-----\\nx\nsops_version=3.13.3\n`;
  assert.deepStrictEqual(describeFile(file), { names: ['API_TOKEN'], recipients: [a] });
});

test('two members encrypt and decrypt the same file; the committed file holds no values', { skip }, async () => {
  const d = repo(); const ana = member(); const ben = member();
  const s = await ana.team.start(d, 'Ana');
  assert.strictEqual(s.config, 'managed'); assert.deepStrictEqual(s.members.map((m) => [m.name, m.you]), [['Ana', true]]);
  await assert.rejects(ana.team.setValue(d, 'sops_mac', 'x'), /reserved by SOPS/);
  await assert.rejects(ana.team.setValue(d, 'PASSWORD_unencrypted', 'x'), /reserved by SOPS/);
  await ana.team.setValue(d, 'API_TOKEN', TOKEN);
  await ana.team.setValue(d, 'WEBHOOK_URL', URL);
  await ana.team.setValue(d, 'TEST_CERT', CERT);

  const benKey = await ben.team.createKey();
  assert.match(benKey, /^age1[02-9ac-hj-np-z]{58}$/);
  const before = await ben.team.env(d);
  assert.deepStrictEqual(before.env, {}); assert.match(before.error, /cannot open/);
  await assert.rejects(ana.team.addMember(d, { name: 'Ben', recipient: 'age1nope' }), /not an age public key/);
  const after = await ana.team.addMember(d, { name: 'Ben', recipient: benKey });
  assert.deepStrictEqual(after.members.map((m) => [m.name, m.canRead]), [['Ana', true], ['Ben', true]]);

  const want = { API_TOKEN: TOKEN, WEBHOOK_URL: URL, TEST_CERT: CERT };
  assert.deepStrictEqual((await ana.team.env(d)).env, want);
  assert.deepStrictEqual((await ben.team.env(d)).env, want);
  const status = await ben.team.status(d);
  assert.deepStrictEqual(status.names, ['API_TOKEN', 'WEBHOOK_URL', 'TEST_CERT']); assert.ok(status.canRead);
  const committed = fs.readFileSync(path.join(d, FILE), 'utf8');
  for (const v of [TOKEN, URL, 'line two']) assert.ok(!committed.includes(v), 'the encrypted file holds no value');
  assert.ok(!JSON.stringify(status).includes(TOKEN), 'status never carries a value');
  // Both keep their identity in their own secret store; neither private key is in the repository.
  for (const f of [FILE, CONFIG]) assert.ok(!fs.readFileSync(path.join(d, f), 'utf8').includes('AGE-SECRET-KEY'), `${f} holds no private key`);
  // Each guard learned every value, whatever its name.
  assert.strictEqual(ben.guard.values.get(URL), 'WEBHOOK_URL from team secrets');
  // Any member can write the file, so it never sets what changes how teammates' programs start.
  await assert.rejects(ana.team.setValue(d, 'NODE_OPTIONS', '--require ./x.js'), /changes how programs start/);
  await ana.team.encrypt(d, { ...want, NODE_OPTIONS: '--require ./x.js', LD_PRELOAD: '/tmp/x.so' });
  assert.deepStrictEqual((await ben.team.env(d)).env, want);
  // An age private key is caught like any other private key before it is committed.
  const identity = await ben.team.identity();
  assert.deepStrictEqual(new SecretGuard().scanDiff(`+++ b/notes.txt\n+my key: ${identity}\n`), [{ file: 'notes.txt', kind: 'an age private key' }]);
});

test('a removed member cannot decrypt the rotated file, and is told which values to change at the source', { skip }, async () => {
  const d = repo(); const ana = member(); const ben = member();
  await ana.team.start(d, 'Ana');
  await ana.team.setValue(d, 'API_TOKEN', TOKEN);
  const benKey = await ben.team.createKey();
  await ana.team.addMember(d, { name: 'Ben', recipient: benKey });
  assert.deepStrictEqual((await ben.team.env(d)).env, { API_TOKEN: TOKEN });
  const old = fs.readFileSync(path.join(d, FILE), 'utf8');

  await assert.rejects(ana.team.removeMember(d, await ana.team.key()), /your own key/);
  const r = await ana.team.removeMember(d, benKey);
  assert.deepStrictEqual(r.rotate, ['API_TOKEN'], 'the values Ben could read, to change where they were issued');
  assert.deepStrictEqual(r.status.members.map((m) => m.name), ['Ana']);
  assert.ok(!fs.readFileSync(path.join(d, CONFIG), 'utf8').includes(benKey));

  const rotated = fs.readFileSync(path.join(d, FILE), 'utf8');
  assert.notStrictEqual(rotated, old);
  assert.ok(!rotated.includes(benKey), 'the file is no longer encrypted to Ben');
  const denied = await ben.team.env(d);
  assert.deepStrictEqual(denied.env, {}); assert.match(denied.error, /cannot open/);
  assert.deepStrictEqual((await ana.team.env(d)).env, { API_TOKEN: TOKEN }, 'the others still read it');
  // A new value after removal stays out of Ben's reach too.
  await ana.team.setValue(d, 'API_TOKEN', `${TOKEN}_rotated`);
  assert.match((await ben.team.env(d)).error, /cannot open/);
  // Why the real values must change: the old ciphertext (still in git history) opens with Ben's key.
  fs.writeFileSync(path.join(d, FILE), old);
  assert.deepStrictEqual((await ben.team.env(d)).env, { API_TOKEN: TOKEN });
});

// An agent that runs a snippet of JavaScript and replies with what it says.
const agent = (id, say) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:${say}}})); console.log(JSON.stringify({type:'turn.completed'}));`] });

test('team values reach a turn\'s environment, the transcript shows [REDACTED], and Commit all refuses them', { skip }, async () => {
  // Ana set the values up earlier (another process, so this hub's secret guard has not seen them).
  const d = repo(); const secrets = new MemorySecrets(); const setup = new TeamSecrets(secrets);
  await setup.start(d, 'Ana');
  await setup.setValue(d, 'API_TOKEN', TOKEN);
  await setup.setValue(d, 'WEBHOOK_URL', URL);
  const hub = new Hub({ dataDir: tmp(), secrets, home: tmp() }); // no init: agents are set here, not detected
  hub.addProject(d);
  hub.agents = [agent('envy', "'token ' + process.env.API_TOKEN + ' (' + process.env.API_TOKEN.length + ' chars), hook ' + process.env.WEBHOOK_URL + '; ' + (fs.writeFileSync('app.js', 'module.exports = ' + JSON.stringify(process.env.API_TOKEN) + ';\\n'), 'saved')")];

  const t = hub.createThread(d);
  const reply = await hub.send({ threadId: t.id, agentId: 'envy', text: 'use the token' });
  assert.strictEqual(reply.text, `token [REDACTED] (${TOKEN.length} chars), hook [REDACTED]; saved`);
  assert.deepStrictEqual(reply.notices.filter((n) => /Team secrets/.test(n)), []);
  assert.ok(!JSON.stringify(hub.thread(t.id).messages).includes(TOKEN), 'nothing stored holds the value');
  assert.match(fs.readFileSync(path.join(d, 'app.js'), 'utf8'), new RegExp(TOKEN), 'the agent really had the value');
  await assert.rejects(hub.commit(d, 'hardcode it'), (e) => /looks like a secret/.test(e.message) && /API_TOKEN from team secrets in app\.js/.test(e.message) && !e.message.includes(TOKEN));
  assert.deepStrictEqual(await hub.teamEnvFor(d), { API_TOKEN: TOKEN, WEBHOOK_URL: URL }, 'terminals in the project get them too');
  assert.deepStrictEqual(await hub.teamEnvFor(os.homedir()), {}, 'but not terminals elsewhere');

  // Someone who is not a member runs turns as before, with a notice instead of the values.
  const other = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  other.addProject(d); other.agents = [agent('plain', "'has token: ' + ('API_TOKEN' in process.env)")];
  await other.teamSecrets.createKey();
  const r = await other.send({ threadId: other.createThread(d).id, agentId: 'plain', text: 'hi' });
  assert.strictEqual(r.text, 'has token: false');
  assert.ok(r.notices.some((n) => /^Team secrets not loaded: .*cannot open/.test(n)), r.notices.join('; '));
});

test('a project room hands out members\' age public keys, never anything else', async () => {
  const dir = tmp(); const ownerKey = 'o'.repeat(43);
  const service = createService({ dbPath: path.join(dir, 'room.sqlite'), bootstrapToken: ownerKey, ownerName: 'Owner' });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${service.server.address().port}`;
  const request = async (key, route, body) => {
    const r = await fetch(url + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json', 'x-command-id': crypto.randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  try {
    const p = (await request(ownerKey, '/api/projects', { name: 'Shared' })).data;
    const ben = (await request(ownerKey, `/api/projects/${p.id}/invite`, { name: 'Ben' })).data;
    const key = await member().team.createKey();
    assert.strictEqual((await request(ben.accessKey, `/api/projects/${p.id}/age-key`, { recipient: 'AGE-SECRET-KEY-1NOTAPUBLICKEY' })).status, 400);
    assert.strictEqual((await request(ben.accessKey, `/api/projects/${p.id}/age-key`, { recipient: key })).status, 200);
    const snap = (await request(ownerKey, `/api/projects/${p.id}/snapshot`)).data;
    assert.deepStrictEqual(snap.members.map((m) => [m.name, m.ageKey || null]), [['Ben', key], ['Owner', null]]);
  } finally { await service.close(); }
});

test('the desktop app and the extension expose the same team secrets calls, and none returns values', () => {
  for (const file of ['desktop/main.js', 'vscode/extension.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const m of ['teamSecrets', 'createTeamKey', 'startTeamSecrets', 'setTeamSecret', 'addTeamMember', 'removeTeamMember']) assert.match(src, new RegExp(`\\b${m}: \\(`), `${file} exposes ${m}`);
    assert.ok(!/teamSecrets\.(env|values)\(/.test(src), `${file} never sends decrypted values to the window`);
    assert.match(src, /teamEnvFor\(/, `${file} gives terminals the team's values`);
  }
});
