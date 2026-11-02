'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// The tributary command line, run as a real subprocess against fake agents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'cli', 'tributary.js');
const FAKE = path.join(__dirname, 'fake-text-agent.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-cli-'));

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
