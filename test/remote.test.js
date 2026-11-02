'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// SSH remote-host mode. A stand-in `ssh` on PATH (test/fake-ssh.js) runs every "remote" command on
// this machine the way sshd would, so the suite stays offline.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skip = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-remote-'));
const BIN = tmp();
const REMOTE_HOME = tmp();
const LOG = path.join(tmp(), 'ssh.log');
fs.writeFileSync(path.join(BIN, 'ssh'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(__dirname, 'fake-ssh.js'))});\n`, { mode: 0o755 });
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_SSH_HOME = REMOTE_HOME;
process.env.FAKE_SSH_LOG = LOG;
process.env.TRIBUTARY_SSH_CONTROL_DIR = tmp();

const { sshHost, connect } = require('../core/host');

const box = (dir) => ({ target: 'dev@buildbox', path: dir });
const sshCalls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// The remote commands sent while fn runs (the fake host is this machine, so results alone can't tell).
const sentOverSsh = async (fn) => { const n = sshCalls().length; const result = await fn(); return { result, commands: sshCalls().slice(n).map((c) => c.command) }; };

test('ssh host: arguments reach the remote command exactly, in the remote folder, with no shell injection', { skip }, async () => {
  const dir = tmp();
  const host = sshHost(box(dir));
  const tricky = ['a b', "it's", '$(touch pwned1)', '`touch pwned2`', '; touch pwned3', '"quoted"', 'back\\slash', 'two\nlines', '*', ''];
  const r = await host.exec(process.execPath, ['-e', 'console.log(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), key: process.env.API_KEY, home: process.env.HOME }))', ...tricky],
    { cwd: dir, env: { API_KEY: "sk-secret $(touch pwned4) 'x'" } });
  assert.strictEqual(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.argv, tricky);
  assert.strictEqual(out.cwd, fs.realpathSync(dir));
  assert.strictEqual(out.key, "sk-secret $(touch pwned4) 'x'");
  assert.strictEqual(out.home, REMOTE_HOME, 'runs in the remote login environment, not this one');
  for (const d of [dir, REMOTE_HOME]) assert.deepStrictEqual(fs.readdirSync(d).filter((f) => f.startsWith('pwned')), []);
  // Secrets travel on stdin, never on a command line other users of the host could read with ps.
  assert.ok(!fs.readFileSync(LOG, 'utf8').includes('sk-secret'));
  // Every call goes through one reusable, multiplexed connection.
  const call = sshCalls().pop();
  assert.strictEqual(call.dest, 'dev@buildbox');
  assert.ok(call.o.includes('ControlMaster=auto'));
  assert.ok(call.o.some((o) => o.startsWith('ControlPersist=')));
  assert.ok(call.o.some((o) => o.startsWith('ControlPath=')));
  assert.ok(call.o.includes('BatchMode=yes'));
});

test('ssh host: bad targets are refused before ssh runs, and connection errors are reported', { skip }, async () => {
  for (const target of ['-oProxyCommand=touch /tmp/x', 'dev@box; rm -rf ~', 'a b', '']) assert.throws(() => sshHost({ target }), /Not a valid SSH target/);
  assert.throws(() => sshHost({ target: 'box', port: 'abc' }), /Not a valid SSH port/);
  await assert.rejects(connect({ target: 'dev@unreachable' }), /Could not resolve hostname/);
  await connect({ target: 'dev@buildbox' });
});

const { runTurn } = require('../core/runner');
const FAKE = path.join(__dirname, 'fake-agent.js');

test('agent turn: runs on the host, streams through the usual parser, and needs no local install', { skip }, async () => {
  const dir = tmp();
  // Not installed on this computer; the host has it.
  const agent = { id: 'claude', name: 'Claude Code', protocol: 'claude-stream', available: false, path: null, bins: ['claude'], remoteCommand: process.execPath, stdinPrompt: true,
    args: ({ resumeId }) => [FAKE, 'claude-stream', ...(resumeId ? ['--resume', resumeId] : [])] };
  const events = [];
  const r = await runTurn({ agent, cwd: dir, prompt: 'hello from the laptop', host: sshHost(box(dir)), onEvent: (e) => events.push(e) });
  assert.strictEqual(r.ok, true, JSON.stringify(events.filter((e) => e.kind === 'error')));
  assert.match(r.text, /ECHO:hello from the laptop/);
  assert.match(r.sessionId, /^sess-/);
  // The fake agent reports an edit in its working folder: the remote project folder.
  const tool = events.find((e) => e.kind === 'tool' && e.name === 'Edit');
  assert.strictEqual(tool.input.file_path, `${fs.realpathSync(dir)}/a.txt`);
  const call = sshCalls().pop();
  assert.ok(call.command.includes(`'${process.execPath}'`));
});

test('agent turn: only the agent and gateway variables are sent, not this computer\'s environment', { skip }, async () => {
  const dir = tmp();
  process.env.TRIBUTARY_LOCAL_ONLY = 'should-stay-here';
  const script = "console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:JSON.stringify({key:process.env.GATEWAY_KEY,color:process.env.NO_COLOR,local:process.env.TRIBUTARY_LOCAL_ONLY||null,home:process.env.HOME})}}));console.log(JSON.stringify({type:'turn.completed'}))";
  const agent = { id: 'codex', name: 'Codex', protocol: 'codex-exec', available: true, path: '/not/on/the/host', remoteCommand: process.execPath, stdinPrompt: true, args: () => ['-e', script] };
  const r = await runTurn({ agent, cwd: dir, prompt: 'x', env: { GATEWAY_KEY: 'sk-gw' }, host: sshHost(box(dir)), onEvent: () => {} });
  delete process.env.TRIBUTARY_LOCAL_ONLY;
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(JSON.parse(r.text), { key: 'sk-gw', color: '1', local: null, home: REMOTE_HOME });
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('agent turn: stop ends the agent and everything it started on the host', { skip }, async () => {
  const dir = tmp();
  // The agent starts a long-running tool, records both process ids, then waits forever.
  const script = "const { spawn } = require('child_process'); const tool = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });"
    + "require('fs').writeFileSync('pids.json', JSON.stringify([process.pid, tool.pid])); setInterval(() => {}, 1000);";
  const agent = { id: 'codex', name: 'Codex', protocol: 'codex-exec', available: true, remoteCommand: process.execPath, args: () => ['-e', script] };
  const ac = new AbortController(); const events = [];
  const turn = runTurn({ agent, cwd: dir, prompt: 'x', host: sshHost(box(dir)), signal: ac.signal, onEvent: (e) => events.push(e) });
  assert.ok(await waitFor(() => fs.existsSync(path.join(dir, 'pids.json'))), 'agent started');
  const pids = JSON.parse(fs.readFileSync(path.join(dir, 'pids.json'), 'utf8'));
  assert.ok(pids.every(alive));
  ac.abort();
  const r = await turn;
  assert.strictEqual(r.ok, false);
  assert.ok(events.some((e) => e.kind === 'notice' && /Stopped/.test(e.text)));
  assert.ok(await waitFor(() => !pids.some(alive)), `still running on the host: ${pids.filter(alive)}`);
  // Nothing is left behind in the host's run folder.
  assert.ok(await waitFor(() => !fs.existsSync(path.join(REMOTE_HOME, '.cache/tributary/run')) || fs.readdirSync(path.join(REMOTE_HOME, '.cache/tributary/run')).length === 0));
});

const { execFileSync } = require('child_process');
const git = require('../core/git');
const { createCheckpoint, restoreCheckpoint, changedBetween, diffBetween } = require('../core/checkpoint');
const repo = (files = { 'a.txt': 'one\n' }) => {
  const d = tmp();
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: d }); execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body);
  execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['commit', '-qm', 'init'], { cwd: d });
  return fs.realpathSync(d);
};

test('git helpers: status, diffs, file list and commit run on the host', { skip }, async () => {
  const d = repo();
  const host = sshHost(box(d));
  fs.writeFileSync(path.join(d, 'a.txt'), 'two\n');
  fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src', 'new.ts'), 'export {}\n');
  const { result: info, commands } = await sentOverSsh(() => git.gitInfo(d, { host }));
  assert.strictEqual(info.root, d);
  assert.deepStrictEqual(info.changed.map((c) => c.path).sort(), ['a.txt', 'src/new.ts']);
  assert.ok(commands.some((c) => c.includes("'git' 'status'")), 'git ran on the host');
  assert.match(await git.fileDiff(d, 'a.txt', { host }), /-one\n\+two/);
  assert.match(await git.fileDiff(d, 'src/new.ts', { host }), /new file src\/new\.ts\n\+export \{\}/);
  assert.strictEqual(await git.headContent(d, 'a.txt', { host }), 'one\n');
  assert.deepStrictEqual((await git.listFiles(d, 100, { host })).sort(), ['a.txt', 'src/new.ts']);
  const commit = await sentOverSsh(() => git.commitAll(d, 'from the laptop', { host }));
  assert.ok(commit.commands.some((c) => c.includes("'git' 'commit'")));
  assert.strictEqual(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: d, encoding: 'utf8' }).trim(), 'from the laptop');
  assert.strictEqual(await git.gitInfo(tmp(), { host }), null, 'a folder without git');
});

test('git helpers: a turn\'s touched files are found from fingerprints taken on the host', { skip }, async () => {
  const d = repo();
  const host = sshHost(box(d));
  fs.writeFileSync(path.join(d, 'a.txt'), 'dirty before the turn\n'); fs.writeFileSync(path.join(d, 'scratch.txt'), 'x');
  const before = await git.gitInfo(d, { host });
  const prints = await git.fingerprintsOn(host, before.root, before.changed);
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(d, 'a.txt'), 'edited by the agent\n'); fs.rmSync(path.join(d, 'scratch.txt')); fs.writeFileSync(path.join(d, 'b.txt'), 'new');
  const after = await git.gitInfo(d, { host });
  const changed = git.touched(prints, after, await git.fingerprintsOn(host, after.root, after.changed));
  assert.deepStrictEqual(changed.map((c) => `${c.code} ${c.path}`).sort(), ['?? b.txt', 'M a.txt', 'reverted scratch.txt']);
});

test('checkpoints: taken and restored on the host, stored in Tributary\'s store there', { skip }, async () => {
  const d = repo({ 'a.txt': 'one\n', 'run.sh': '#!/bin/sh\necho hi\n' });
  fs.chmodSync(path.join(d, 'run.sh'), 0o755); execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['commit', '-qm', 'exec'], { cwd: d });
  const host = sshHost(box(d));
  fs.writeFileSync(path.join(d, 'a.txt'), 'uncommitted\n'); fs.writeFileSync(path.join(d, 'notes.txt'), 'keep me\n');
  const cp = await createCheckpoint(d, 'turn-1', { host });
  // The turn edits, deletes and creates files.
  fs.writeFileSync(path.join(d, 'a.txt'), 'agent\n'); fs.rmSync(path.join(d, 'notes.txt')); fs.writeFileSync(path.join(d, 'later.txt'), 'later\n');
  fs.writeFileSync(path.join(d, 'run.sh'), '#!/bin/sh\necho changed\n');
  assert.deepStrictEqual((await changedBetween(d, cp, null, { host })).map((c) => `${c.code} ${c.path}`).sort(), ['A later.txt', 'D notes.txt', 'M a.txt', 'M run.sh']);
  assert.match(await diffBetween(d, cp, null, 'a.txt', { host }), /-uncommitted\n\+agent/);
  const r = await restoreCheckpoint(d, cp, { host });
  assert.deepStrictEqual(r, { restored: 3, removed: 1 });
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'uncommitted\n');
  assert.strictEqual(fs.readFileSync(path.join(d, 'notes.txt'), 'utf8'), 'keep me\n');
  assert.strictEqual(fs.readFileSync(path.join(d, 'run.sh'), 'utf8'), '#!/bin/sh\necho hi\n');
  assert.strictEqual(fs.statSync(path.join(d, 'run.sh')).mode & 0o111, 0o111, 'executable bit restored');
  assert.ok(!fs.existsSync(path.join(d, 'later.txt')));
  // Objects went to the host's store, not into the repository and not onto this computer.
  assert.ok(fs.readdirSync(path.join(REMOTE_HOME, '.local/share/tributary/checkpoints')).length > 0);
  assert.deepStrictEqual(fs.readdirSync(process.env.TRIBUTARY_CHECKPOINT_DIR), []);
  assert.throws(() => execFileSync('git', ['cat-file', '-e', cp], { cwd: d, stdio: 'ignore' }));
});

const { race, applyDiff } = require('../core/race');

test('race: worktrees, agent turns and the test command run on the host, and the winner is applied there', { skip }, async () => {
  const d = repo({ 'calc.js': 'module.exports = (a, b) => a - b;\n' });
  fs.writeFileSync(path.join(d, 'notes.txt'), 'uncommitted work\n');
  const host = sshHost(box(d));
  const writer = (id, body) => ({ id, name: id, protocol: 'codex-exec', available: false, remoteCommand: process.execPath, stdinPrompt: true,
    args: () => ['-e', `require('fs').writeFileSync('calc.js', ${JSON.stringify(body)});console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'done by ${id} in '+process.cwd()+' notes='+require('fs').existsSync('notes.txt')}}));console.log(JSON.stringify({type:'turn.completed'}))`] });
  const agents = [writer('good', 'module.exports = (a, b) => a + b;\n'), writer('bad', 'module.exports = () => 0;\n')];
  const testCommand = `'${process.execPath}' -e "process.exit(require('./calc.js')(2,3)===5?0:1)"`;
  const { result: r, commands } = await sentOverSsh(() => race(null, { root: d, project: d, prompts: { good: 'fix add', bad: 'fix add' }, agents, testCommand, host }));
  const by = Object.fromEntries(r.candidates.map((c) => [c.agent, c]));
  assert.strictEqual(by.good.tests, 'passed', by.good.testOutput || by.good.error);
  assert.strictEqual(by.bad.tests, 'failed');
  assert.deepStrictEqual(by.good.files, ['calc.js']);
  assert.match(by.good.text, /done by good in \/.*tributary-race-.*\/good notes=true/);
  assert.match(by.good.branch, /^tributary\/race-[0-9a-f]+\/good$/);
  assert.ok(commands.some((c) => c.includes("'git' 'worktree' 'add'")), 'worktrees were made on the host');
  assert.ok(commands.some((c) => c.includes("'/bin/sh' '-c'") && c.includes('calc.js')), 'the test command ran on the host');
  // The project is untouched and the worktrees are gone until a result is applied.
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a - b;\n');
  assert.strictEqual(execFileSync('git', ['worktree', 'list'], { cwd: d, encoding: 'utf8' }).trim().split('\n').length, 1);
  const applied = await sentOverSsh(() => applyDiff(d, by.good.diff, { host }));
  assert.ok(applied.commands.some((c) => c.includes("'git' 'merge-tree'")));
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
  assert.strictEqual(fs.readFileSync(path.join(d, 'notes.txt'), 'utf8'), 'uncommitted work\n');
});
