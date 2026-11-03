'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Copies that run: a separate copy gets the project's gitignored .env files (or what .worktreeinclude lists),
// and those copied files never end up in a commit, even if an agent un-ignores them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { includedFiles } = require('../core/workspace-setup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-ws-'));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const put = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
// A repository with tracked code, gitignored env files, an ignored dependency folder and an untracked note.
const repo = () => {
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  put(d, '.gitignore', '.env\n.env.*\n!.env.example\nnode_modules/\nconfig/*.json\nsecret.key\n.venv-like/\n');
  put(d, 'app.js', 'console.log(process.env.API_TOKEN);\n');
  put(d, '.env.example', 'API_TOKEN=\n');
  put(d, 'web/page.js', 'export default 1;\n');
  sh(d, 'add', '.'); sh(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  put(d, '.env', 'API_TOKEN=tok_live_1234567890\n');
  put(d, 'web/.env.local', 'NEXT_PUBLIC_X=1\n');
  put(d, 'node_modules/dep/index.js', 'module.exports = 1;\n');
  put(d, 'config/local.json', '{"db":"dev"}\n');
  put(d, 'config/skip.json', '{"skip":true}\n');
  put(d, 'secret.key', 'KEY\n');
  put(d, 'notes.txt', 'not ignored, not copied\n');
  return d;
};
// Fake agent that runs a snippet of JavaScript in its working folder.
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'ok'}})); console.log(JSON.stringify({type:'turn.completed'}));`] });
async function setup(agents = []) {
  const d = repo();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = agents;
  return { d, hub };
}

test('without a .worktreeinclude, the gitignored .env files are picked, and nothing else', async () => {
  const d = repo();
  assert.deepStrictEqual((await includedFiles(d)).sort(), ['.env', 'web/.env.local']);
});

test('.worktreeinclude picks gitignored files in gitignore syntax, with ! to leave some out', async () => {
  const d = repo();
  put(d, '.worktreeinclude', '# copied into every copy\n.env\nconfig/*.json\n!config/skip.json\nnotes.txt\napp.js\n');
  // notes.txt is not ignored and app.js is tracked: only gitignored files are ever copied.
  assert.deepStrictEqual((await includedFiles(d)).sort(), ['.env', 'config/local.json']);
});

test('symlinks and a folder named .env are never copied', async () => {
  const d = repo();
  fs.symlinkSync(path.join(os.tmpdir()), path.join(d, '.env.link'));
  fs.mkdirSync(path.join(d, '.env.d')); fs.writeFileSync(path.join(d, '.env.d', 'x'), 'x');
  assert.deepStrictEqual((await includedFiles(d)).sort(), ['.env', 'web/.env.local']);
});

test('a new separate copy gets the .env files, readable only by you, and the conversation records them', async () => {
  const { d, hub } = await setup();
  const t = hub.createThread(d);
  const st = await hub.createWorktree(t.id);
  assert.strictEqual(fs.readFileSync(path.join(st.path, '.env'), 'utf8'), 'API_TOKEN=tok_live_1234567890\n');
  assert.strictEqual(fs.readFileSync(path.join(st.path, 'web/.env.local'), 'utf8'), 'NEXT_PUBLIC_X=1\n');
  assert.strictEqual(fs.statSync(path.join(st.path, '.env')).mode & 0o077, 0, 'not readable by others');
  for (const f of ['notes.txt', 'node_modules/dep/index.js', 'secret.key']) assert.ok(!fs.existsSync(path.join(st.path, f)), f);
  assert.deepStrictEqual(hub.thread(t.id).worktree.copied.sort(), ['.env', 'web/.env.local']);
  assert.deepStrictEqual(st.copied.sort(), ['.env', 'web/.env.local']);
  assert.deepStrictEqual(st.files, [], 'copied files are not changes');
  hub.store.save(true);
});

test('copied files are never committed, even after an agent un-ignores them', async () => {
  const { d, hub } = await setup([agent('dev', "fs.writeFileSync('.gitignore', 'node_modules/\\n'); fs.appendFileSync('app.js', '// changed\\n')")]);
  const t = hub.createThread(d);
  await hub.createWorktree(t.id);
  await hub.send({ threadId: t.id, agentId: 'dev', text: 'tidy the ignore file' });
  const r = await hub.mergeWorktree(t.id);
  assert.deepStrictEqual(r.files.sort(), ['.gitignore', 'app.js']);
  const committed = sh(d, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(!committed.includes('.env') && !committed.includes('web/.env.local'), committed.join(','));
  assert.strictEqual(sh(d, 'ls-files', '.env', 'web/.env.local'), '');
  hub.store.save(true);
});

test('each copy gets its own block of ports, which its turns and terminals see', async () => {
  const report = agent('env', "fs.writeFileSync('env.json', JSON.stringify({ port: process.env.TRIBUTARY_PORT, PORT: process.env.PORT, root: process.env.TRIBUTARY_ROOT_PATH, ws: process.env.TRIBUTARY_WORKSPACE }))");
  const { d, hub } = await setup([report]);
  const a = hub.createThread(d); const b = hub.createThread(d);
  const sa = await hub.createWorktree(a.id); const sb = await hub.createWorktree(b.id);
  assert.ok(sa.port >= 1024 && sb.port >= 1024 && Math.abs(sa.port - sb.port) >= 10, `${sa.port} ${sb.port}`);
  await hub.send({ threadId: a.id, agentId: 'env', text: 'report' });
  const seen = JSON.parse(fs.readFileSync(path.join(sa.cwd, 'env.json'), 'utf8'));
  assert.deepStrictEqual(seen, { port: String(sa.port), PORT: String(sa.port), root: fs.realpathSync(d), ws: sa.path });
  assert.strictEqual(hub.workspaceEnvFor(sa.cwd).TRIBUTARY_PORT, String(sa.port), 'a terminal in the copy gets the same ports');
  assert.strictEqual(hub.workspaceEnvFor(path.join(sa.path, 'web')).TRIBUTARY_PORT, String(sa.port));
  assert.deepStrictEqual(hub.workspaceEnvFor(d), {}, 'the project folder keeps its usual ports');
  // A discarded copy's ports go to the next copy.
  await hub.discardWorktree(a.id);
  const c = hub.createThread(d);
  assert.strictEqual((await hub.createWorktree(c.id)).port, sa.port);
  hub.store.save(true);
});
