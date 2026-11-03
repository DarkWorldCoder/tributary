'use strict';
require('./helpers/tmp').useCheckpointDir();
// The tributary command line, run as a real subprocess against fake agents.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'cli', 'tributary.js');
const FAKE = path.join(__dirname, 'fake-text-agent.js');
const tmp = () => mkTmp('cli');

function setup() {
  const data = tmp(); const proj = tmp();
  execFileSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'README.md'), '# demo\n');
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
  const agent = (id) => ({ id, name: id[0].toUpperCase() + id.slice(1), command: process.execPath, args: [FAKE, id, '{prompt}'], protocol: 'text' });
  fs.writeFileSync(path.join(data, 'agents.json'), JSON.stringify({ agents: [agent('alpha'), agent('beta')] }));
  // PATH without real agents keeps the tests offline and fast.
  const env = { ...process.env, TRIBUTARY_DATA_DIR: data, PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', NO_COLOR: '1', HOME: tmp() };
  const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd: proj, env, encoding: 'utf8', timeout: 60000, ...opts });
  return { data, proj, run };
}

test('agents lists what is installed, as text and JSON', () => {
  const { run } = setup();
  const r = run(['agents', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const list = JSON.parse(r.stdout);
  assert.ok(list.find((a) => a.id === 'alpha' && a.available));
  const t = run(['agents']);
  assert.match(t.stdout, /Alpha/); assert.match(t.stdout, /ready/i);
});

test('ask runs a turn in the current folder and the next ask continues the same thread', () => {
  const { run, proj } = setup();
  const a = run(['ask', '-a', 'alpha', 'make a file WRITE:notes.txt=hello']);
  assert.strictEqual(a.status, 0, a.stderr);
  assert.match(a.stdout, /alpha says: make a file WRITE:notes.txt=hello/);
  assert.match(a.stdout, /notes\.txt/, 'lists changed files');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'notes.txt'), 'utf8'), 'hello by alpha\n');
  const b = run(['ask', '-a', 'beta', 'review it']);
  assert.strictEqual(b.status, 0, b.stderr);
  assert.match(b.stdout, /beta says: review it/);
  const threads = JSON.parse(run(['threads', '--json']).stdout);
  assert.strictEqual(threads.length, 1);
  assert.strictEqual(threads[0].count, 4);
  const shown = run(['show']);
  assert.match(shown.stdout, /alpha says/); assert.match(shown.stdout, /beta says/);
  const n = run(['ask', '--new', '-a', 'alpha', 'fresh start']);
  assert.strictEqual(n.status, 0);
  assert.strictEqual(JSON.parse(run(['threads', '--json']).stdout).length, 2);
});

test('ask reads the request from stdin with "-"', () => {
  const { run } = setup();
  const r = run(['ask', '-a', 'alpha', '-'], { input: 'from stdin\n' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /alpha says: from stdin/);
});

test('race runs agents in separate copies, tests decide, and apply copies the winner', () => {
  const { run, proj } = setup();
  const r = run(['race', '-a', 'alpha,beta', '--test', `node -e "process.exit(require('fs').readFileSync('out.txt','utf8').includes('alpha')?0:1)"`, 'write WRITE:out.txt=result']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Alpha[\s\S]*passed/); assert.match(r.stdout, /Beta[\s\S]*failed/);
  assert.ok(!fs.existsSync(path.join(proj, 'out.txt')), 'project untouched before apply');
  const ap = run(['apply', 'alpha']);
  assert.strictEqual(ap.status, 0, ap.stderr);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'out.txt'), 'utf8'), 'result by alpha\n');
});

test('memory: enable, remember and show', () => {
  const { run, proj } = setup();
  assert.strictEqual(run(['memory', 'enable']).status, 0);
  assert.strictEqual(run(['memory', 'remember', 'Use pnpm, not npm']).status, 0);
  const s = run(['memory']);
  assert.match(s.stdout, /Use pnpm, not npm/);
  assert.ok(fs.existsSync(path.join(proj, '.tributary', 'memory.md')));
});

test('export writes the thread as Markdown', () => {
  const { run, proj } = setup();
  run(['ask', '-a', 'alpha', 'hello']);
  const out = path.join(proj, 'thread.md');
  assert.strictEqual(run(['export', '-o', out]).status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /## Alpha[\s\S]*alpha says: hello/);
});

test('helpful errors: unknown command, unknown agent, missing prompt', () => {
  const { run } = setup();
  const u = run(['frobnicate']);
  assert.strictEqual(u.status, 2); assert.match(u.stderr, /Unknown command/); assert.match(u.stderr, /tributary ask/);
  const a = run(['ask', '-a', 'nope', 'hi']);
  assert.strictEqual(a.status, 1); assert.match(a.stderr, /Unknown agent "nope"[\s\S]*alpha/);
  const p = run(['ask', '-a', 'alpha']);
  assert.strictEqual(p.status, 2); assert.match(p.stderr, /What should the agent do/);
  const h = run(['--help']);
  assert.strictEqual(h.status, 0); assert.match(h.stdout, /Usage: tributary/);
});

test('by default the CLI uses the desktop app’s data folder, and both see the same history at once', { skip: process.platform !== 'linux' }, () => {
  const { proj, data, run } = setup();
  const home = tmp(); const desktopDir = path.join(home, '.config', 'Tributary');
  fs.mkdirSync(desktopDir, { recursive: true });
  fs.copyFileSync(path.join(data, 'agents.json'), path.join(desktopDir, 'agents.json'));
  const env = { ...process.env, HOME: home, PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', NO_COLOR: '1' };
  delete env.TRIBUTARY_DATA_DIR; delete env.XDG_CONFIG_HOME;
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: proj, env, encoding: 'utf8', timeout: 60000 });
  const doctor = JSON.parse(cli(['doctor', '--json']).stdout);
  assert.strictEqual(doctor.find((c) => c.label === 'Data folder').detail, desktopDir);
  assert.ok(!fs.existsSync(path.join(desktopDir, 'cli')), 'no separate CLI store');

  // The desktop app is open on the same folder while the CLI works.
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const desktop = new Hub({ dataDir: desktopDir, secrets: new MemorySecrets(), home });
  const started = desktop.createThread(fs.realpathSync(proj), 'Started in the app'); desktop.store.save(true);
  const listed = JSON.parse(cli(['threads', '--json']).stdout);
  assert.deepStrictEqual(listed.map((t) => t.title), ['Started in the app']);
  const r = cli(['ask', '-a', 'alpha', 'continue from the CLI']);
  assert.strictEqual(r.status, 0, r.stderr);
  desktop.store.sync();
  assert.deepStrictEqual(desktop.thread(started.id).messages.map((m) => m.text.trim()), ['continue from the CLI', 'alpha says: continue from the CLI']);
  desktop.setSettings({ mode: 'read' }); desktop.store.save(true);
  const shown = cli(['show']);
  assert.match(shown.stdout, /alpha says: continue from the CLI/);
  desktop.store.close();
});

test('threads from the old separate CLI folder are imported into the shared history once', { skip: process.platform !== 'linux' }, () => {
  const { proj, run } = setup();
  const home = tmp(); const desktopDir = path.join(home, '.config', 'Tributary'); const old = path.join(desktopDir, 'cli');
  fs.mkdirSync(old, { recursive: true });
  const real = fs.realpathSync(proj);
  fs.writeFileSync(path.join(old, 'hub.json'), JSON.stringify({ version: 1, settings: {}, gateways: [], notifications: [],
    projects: [{ path: real, name: 'demo', trusted: true, addedAt: 1 }],
    threads: [{ id: 'old-cli-thread', project: real, title: 'From the old CLI folder', createdAt: 1, updatedAt: 2, agentSessions: {}, lastAgent: 'alpha', messages: [{ id: 'u1', role: 'user', text: 'old request', target: 'alpha' }] }] }));
  const env = { ...process.env, HOME: home, PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', NO_COLOR: '1' };
  delete env.TRIBUTARY_DATA_DIR; delete env.XDG_CONFIG_HOME;
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: proj, env, encoding: 'utf8', timeout: 60000 });
  assert.deepStrictEqual(JSON.parse(cli(['threads', '--json']).stdout).map((t) => t.title), ['From the old CLI folder']);
  assert.ok(!fs.existsSync(path.join(old, 'hub.json')) && fs.existsSync(path.join(old, 'hub.json.migrated')));
  assert.ok(!fs.existsSync(path.join(old, 'tributary.db')), 'the old folder is not used as a store');
  assert.strictEqual(JSON.parse(cli(['threads', '--json']).stdout).length, 1, 'imported once');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const desktop = new Hub({ dataDir: desktopDir, secrets: new MemorySecrets(), home });
  assert.strictEqual(desktop.thread('old-cli-thread').messages[0].text, 'old request', 'the desktop app sees it too');
  desktop.store.close();
});

test('ask --separate works in its own git worktree; merge brings it back, reports conflicts, and discard removes it', () => {
  const { run, proj } = setup();
  const git = (...args) => execFileSync('git', args, { cwd: proj, encoding: 'utf8' }).trim();
  const a = run(['ask', '--separate', '-a', 'alpha', 'WRITE:notes.txt=hello']);
  assert.strictEqual(a.status, 0, a.stderr);
  assert.match(a.stdout, /tributary\/thread-[0-9a-f]{8}/);
  assert.ok(!fs.existsSync(path.join(proj, 'notes.txt')), 'the project folder is untouched');
  // A plain ask continues that thread in its copy; another --separate starts a second thread with its own copy.
  assert.strictEqual(run(['ask', '-a', 'alpha', 'WRITE:clash.txt=one']).status, 0);
  const b = run(['ask', '--separate', '-a', 'beta', 'WRITE:clash.txt=two']);
  assert.strictEqual(b.status, 0, b.stderr);
  const [second, first] = JSON.parse(run(['threads', '--json']).stdout);
  assert.match(first.branch, /^tributary\/thread-/); assert.match(second.branch, /^tributary\/thread-/);
  assert.notStrictEqual(first.branch, second.branch);
  assert.match(run(['threads']).stdout, new RegExp(first.branch));
  assert.ok(!fs.existsSync(path.join(proj, 'clash.txt')));

  const m = run(['merge', '-t', first.id]);
  assert.strictEqual(m.status, 0, m.stderr);
  assert.match(m.stdout, new RegExp(`Merged ${first.branch} into \\w+: clash\\.txt, notes\\.txt`));
  assert.strictEqual(fs.readFileSync(path.join(proj, 'notes.txt'), 'utf8'), 'hello by alpha\n');
  assert.strictEqual(git('status', '--porcelain'), '');
  // Without -t, merge picks the latest thread that has a copy: the second one, which conflicts.
  const c = run(['merge']);
  assert.strictEqual(c.status, 1);
  assert.match(c.stderr, /conflict[\s\S]*clash\.txt[\s\S]*kept on branch/i);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'clash.txt'), 'utf8'), 'one by alpha\n');
  const d = run(['discard', '-t', second.id]);
  assert.strictEqual(d.status, 0, d.stderr);
  assert.strictEqual(git('branch', '--list', second.branch), '');
  assert.match(run(['merge', '-t', second.id]).stderr, /not working in a separate copy/);
});
