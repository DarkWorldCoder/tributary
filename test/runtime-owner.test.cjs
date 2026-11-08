'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const { engineBinary } = require('../core/native-engine');
const binary = engineBinary();
let native = false;
try { native = !!binary && JSON.parse(execFileSync(binary, ['--identity'], { encoding: 'utf8', timeout: 3000 })).runtime === 1; } catch {}
const nativeTest = (name, fn) => test(name, { skip: !native }, fn);
const unixNativeTest = (name, fn) => test(name, { skip: !native || process.platform === 'win32' }, fn);
const { spawnOwnedRuntime } = require('../core/local-engine-process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 7000; while (!check()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } }
function alive(pid) {
  try { process.kill(pid, 0); return process.platform !== 'linux' || !/\) Z /.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8')); } catch { return false; }
}
function folder(t, privateName = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-contract-'));
  const cwd = path.join(root, privateName ? 'local-engine-private' : 'ordinary-project'); fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'api-key'), 'test-only-private-marker');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return cwd;
}
function start(t, cwd, code, executable = process.execPath) {
  const child = spawnOwnedRuntime(executable, ['-e', code], { cwd, cleanupDirectory: true });
  const exited = once(child, 'close');
  t.after(async () => { child.stdout.resume(); child.stderr.resume(); if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); await exited; });
  return { child, exited };
}
nativeTest('exact stdout/stderr forwarding preserves binary payloads and later metadata-looking lines', async t => {
  const cwd = folder(t), stdout = Buffer.concat([Buffer.from('{"runtimePid":999999}\n'), Buffer.from([0, 255, 1]), Buffer.from('你好\n'), Buffer.alloc(192 * 1024, 65)]), stderr = Buffer.alloc(96 * 1024, 66);
  const prefix = stdout.subarray(0, stdout.length - 192 * 1024).toString('base64');
  const { child, exited } = start(t, cwd, `process.stdout.write(Buffer.concat([Buffer.from(${JSON.stringify(prefix)},'base64'),Buffer.alloc(192*1024,65)]));process.stderr.write(Buffer.alloc(96*1024,66));process.exitCode=7;`);
  const out = [], err = []; child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => err.push(b));
  const [code] = await exited; assert.equal(code, 7);
  assert.deepEqual(Buffer.concat(out), stdout); assert.deepEqual(Buffer.concat(err), stderr);
  assert.ok(child.runtimePid); assert.equal(child.backend, 'native'); assert.equal(alive(child.runtimePid), false); assert.equal(fs.existsSync(cwd), false);
});
nativeTest('graceful stop delivers SIGTERM and force stop bypasses an ignored SIGTERM', async t => {
  for (const force of [false, true]) {
    const cwd = folder(t); const marker = path.join(path.dirname(cwd), 'term');
    const { child, exited } = start(t, cwd, `process.on('SIGTERM',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'TERM');${force ? '' : 'process.exit(0);'}});console.log('READY');setInterval(()=>{},1000)`);
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.resume();
    await until(() => output.includes('READY'), 'runtime signal handler ready');
    child.kill(force ? 'SIGKILL' : 'SIGTERM'); assert.equal((await exited)[0], 0);
    assert.equal(fs.existsSync(marker), !force && process.platform !== 'win32'); assert.equal(alive(child.runtimePid), false); assert.equal(fs.existsSync(cwd), false);
  }
});
unixNativeTest('graceful stop escalates after the runtime ignores SIGTERM', async t => {
  const cwd = folder(t), { child, exited } = start(t, cwd, "process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)");
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.resume(); await until(() => output.includes('READY'), 'ignored TERM ready');
  child.kill('SIGTERM'); assert.equal((await exited)[0], 0); assert.equal(alive(child.runtimePid), false); assert.equal(fs.existsSync(cwd), false);
});
unixNativeTest('SIGTERM sent to the guardian reaps its runtime and private key', async t => {
  const cwd = folder(t), { child, exited } = start(t, cwd, "console.log('READY');setInterval(()=>{},1000)");
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.resume(); await until(() => output.includes('READY'), 'guardian signal ready');
  process.kill(child.pid, 'SIGTERM'); assert.equal((await exited)[0], 0); assert.equal(alive(child.runtimePid), false); assert.equal(fs.existsSync(cwd), false);
});
unixNativeTest('repeated guardian termination signals retain cleanup ownership until forced reap', async t => {
  const cwd = folder(t), marker = path.join(path.dirname(cwd), 'received-term');
  const { child, exited } = start(t, cwd, `process.on('SIGTERM',()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'TERM'));console.log('READY');setInterval(()=>{},1000)`);
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.resume(); await until(() => output.includes('READY'), 'repeated-signal runtime ready');
  process.kill(child.pid, 'SIGTERM'); await until(() => fs.existsSync(marker), 'initial graceful signal delivered');
  for (let n = 0; n < 3; n++) { process.kill(child.pid, 'SIGTERM'); await delay(10); }
  assert.equal((await exited)[0], 0); assert.equal(alive(child.runtimePid), false); assert.equal(fs.existsSync(cwd), false);
});
nativeTest('missing executable cleans only the private directory; ordinary project cwd survives', async t => {
  for (const privateName of [true, false]) {
    const cwd = folder(t, privateName), { child, exited } = start(t, cwd, '', '/tmp/no-such-tributary-runtime-executable');
    child.stdout.resume(); child.stderr.resume(); assert.equal((await exited)[0], 1);
    assert.equal(child.runtimePid, undefined); assert.equal(fs.existsSync(cwd), !privateName);
  }
});
nativeTest('parent SIGKILL reaps both processes even with paused stdout and a flooding runtime', async t => {
  for (const mode of ['idle', 'flood']) {
    const cwd = folder(t), parent = fork(path.join(__dirname, 'runtime-owner-parent.cjs'), [cwd, mode], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let data; parent.on('message', value => data = value); parent.stderr.resume();
    t.after(() => { if (parent.exitCode === null && !parent.signalCode) parent.kill('SIGKILL'); });
    await until(() => data, 'owned runtime PID'); assert.equal(data.backend, 'native'); await delay(100);
    const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
    await until(() => !alive(data.runtimePid) && !alive(data.guardianPid), 'crash reaping');
    assert.equal(fs.existsSync(cwd), false);
  }
});
nativeTest('explicit stop reaps runtime while stdout remains paused', async t => {
  const cwd = folder(t), { child, exited } = start(t, cwd, "process.stdout.write('X'.repeat(32*1024*1024));setInterval(()=>{},1000)");
  child.stdout.pause(); child.stderr.resume(); await until(() => child.runtimePid, 'paused runtime PID'); await delay(100);
  child.kill('SIGTERM'); await until(() => !alive(child.runtimePid) && !alive(child.pid), 'paused stop reaping');
  assert.equal(fs.existsSync(cwd), false); child.stdout.resume(); assert.equal((await exited)[0], 0);
});

nativeTest('natural exit preserves complete output when the consumer resumes after the helper exits', async t => {
  const cwd = folder(t), { child, exited } = start(t, cwd, 'process.stdout.write(Buffer.alloc(96*1024,65));process.stderr.write(Buffer.alloc(24*1024,66));process.exitCode=7');
  child.stdout.pause(); child.stderr.pause();
  await until(() => child.runtimePid && !alive(child.pid), 'helper natural exit with queued bytes');
  const out = [], err = []; child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => err.push(b)); child.stdout.resume(); child.stderr.resume();
  assert.equal((await exited)[0], 7); assert.deepEqual(Buffer.concat(out), Buffer.alloc(96*1024,65)); assert.deepEqual(Buffer.concat(err), Buffer.alloc(24*1024,66));
});

const { spawnRuntime } = require('../core/native-engine/runtime.cjs');
const resolver = require('../core/native-engine');
function compatible(t, cwd, code, fallbackCounter) {
  return () => {
    fallbackCounter.calls++;
    const original = resolver.engineBinary; resolver.engineBinary = () => null;
    try { return spawnOwnedRuntime(process.execPath, ['-e', code], { cwd, cleanupDirectory: true }); }
    finally { resolver.engineBinary = original; }
  };
}
function controlled(t, mode, code = "console.log('READY');setInterval(()=>{},1000)", extra = {}) {
  const cwd = folder(t), state = path.dirname(cwd), fallbackCounter = { calls: 0 };
  const fallback = compatible(t, cwd, code, fallbackCounter);
  const spawnImpl = (_file, args, options) => spawn(process.execPath, [path.join(__dirname, 'fake-runtime-helper.cjs'), mode, state, ...args], options);
  const owner = spawnRuntime('checked-test-helper', process.execPath, ['-e', code], { cwd, cleanupDirectory: true }, fallback, { spawnImpl, probeMs: 1500, ...extra });
  const errors = []; owner.on('error', error => errors.push(error));
  const closed = new Promise(resolve => owner.once('close', (code, signal) => resolve([code, signal])));
  t.after(async () => { owner.stdout.resume(); owner.stderr.resume(); if (!owner.finished) owner.kill('SIGKILL'); await closed; });
  return { cwd, state, fallbackCounter, owner, closed, errors };
}

test('immediate cancellation starts neither identity work nor a fallback runtime', async () => {
  let starts = 0;
  const owner = spawnRuntime('not-started', 'not-started', [], {}, () => { starts++; }, { spawnImpl() { starts++; throw Error('Must not spawn'); } });
  const closed = new Promise(resolve => owner.once('close', resolve));
  assert.equal(owner.kill('SIGTERM'), true); assert.equal(await closed, 0); assert.equal(starts, 0); assert.equal(owner.pid, undefined);
});

test('cancellation and deadline wait for a hung identity child to be reaped', async t => {
  const { state, owner, closed, fallbackCounter, errors } = controlled(t, 'slow-probe');
  await until(() => fs.existsSync(path.join(state, 'probe-pid')), 'identity probe running');
  const pid = Number(fs.readFileSync(path.join(state, 'probe-pid'), 'utf8'));
  assert.equal(owner.kill('SIGTERM'), true); assert.equal((await closed)[0], 0);
  assert.throws(() => process.kill(pid, 0)); assert.equal(fallbackCounter.calls, 0); assert.deepEqual(errors, []);
});

test('old, wrong-architecture, oversized, failed and timed-out identities use exactly one compatibility owner', async t => {
  for (const mode of ['old-probe', 'wrong-arch', 'large-probe', 'failed-probe', 'slow-probe']) {
    const { owner, closed, fallbackCounter, state, cwd, errors } = controlled(t, mode);
    let output = ''; owner.stdout.on('data', chunk => output += chunk); owner.stderr.resume();
    await until(() => output.includes('READY') && owner.runtimePid, 'compatibility runtime ready');
    assert.equal(owner.backend, 'javascript'); assert.equal(fallbackCounter.calls, 1);
    const pid = Number(fs.readFileSync(path.join(state, 'probe-pid'), 'utf8')); assert.throws(() => process.kill(pid, 0));
    assert.equal(fs.existsSync(path.join(state, 'guard-pid')), false);
    owner.kill('SIGTERM'); assert.equal((await closed)[0], 0); assert.throws(() => process.kill(owner.runtimePid, 0)); assert.equal(fs.existsSync(cwd), false); assert.deepEqual(errors, []);
  }
});

test('a missing native binary uses the compatibility owner without losing streamed output', async t => {
  const cwd = folder(t), count = { calls: 0 }, fallback = compatible(t, cwd, "console.log('READY');setInterval(()=>{},1000)", count);
  const owner = spawnRuntime(path.join(path.dirname(cwd), 'missing-native-helper'), process.execPath, [], { cwd }, fallback);
  const closed = new Promise(resolve => owner.once('close', resolve));
  t.after(async () => { owner.stdout.resume(); owner.stderr.resume(); if (!owner.finished) owner.kill('SIGKILL'); await closed; });
  let output = ''; owner.stdout.on('data', chunk => output += chunk); owner.stderr.resume();
  await until(() => output.includes('READY') && owner.runtimePid, 'missing-helper fallback ready');
  assert.equal(owner.backend, 'javascript'); assert.equal(count.calls, 1);
  owner.kill('SIGTERM'); assert.equal(await closed, 0); assert.throws(() => process.kill(owner.runtimePid, 0));
});

test('fragmented startup metadata is removed once and runtime payload is preserved', async t => {
  const payload = '{"runtimePid":123456}\nनमस्ते\n';
  const { owner, closed, errors, fallbackCounter } = controlled(t, 'fragmented-meta', `process.stdout.write(${JSON.stringify(payload)});process.exitCode=7`);
  const out = []; owner.stdout.on('data', chunk => out.push(chunk)); owner.stderr.resume(); await closed;
  assert.equal(owner.backend, 'native'); assert.ok(owner.runtimePid); assert.equal(fallbackCounter.calls, 0);
  assert.equal(Buffer.concat(out).toString('utf8'), payload); assert.deepEqual(errors, []); assert.throws(() => process.kill(owner.runtimePid, 0));
});

test('invalid, oversized and truncated runtime metadata never create a second model owner', async t => {
  for (const mode of ['bad-meta', 'large-meta', 'partial-meta']) {
    const { owner, closed, state, fallbackCounter, errors } = controlled(t, mode);
    owner.stdout.resume(); owner.stderr.resume(); await closed;
    assert.equal(owner.backend, 'native'); assert.equal(fallbackCounter.calls, 0); assert.equal(errors.length, 1); assert.match(errors[0].message, /metadata/);
    const pid = Number(fs.readFileSync(path.join(state, 'runtime-pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0)); assert.throws(() => process.kill(owner.pid, 0));
  }
});

nativeTest('native runtime launch failure is reported after cleanup without retrying the runtime', async t => {
  const cwd = folder(t); let fallbacks = 0;
  const owner = spawnRuntime(binary, path.join(path.dirname(cwd), 'missing-model-runtime'), [], { cwd, cleanupDirectory: true }, () => { fallbacks++; throw Error('Must not retry'); });
  const closed = new Promise(resolve => owner.once('close', resolve)); owner.stdout.resume(); owner.stderr.resume();
  assert.equal(await closed, 1); assert.equal(owner.backend, 'native'); assert.equal(fallbacks, 0); assert.equal(fs.existsSync(cwd), false); assert.throws(() => process.kill(owner.pid, 0));
});

nativeTest('native startup preserves Unicode, quotes, empty arguments and literal option-looking values', async t => {
  const cwd = folder(t), values = ['sp ace', 'a"b', 'slash\\', 'नमस्ते', '--looks-like-an-option', ''];
  const owner = spawnOwnedRuntime(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exitCode=7', '--', ...values], { cwd, cleanupDirectory: true });
  const closed = new Promise(resolve => owner.once('close', resolve)); const out = []; owner.stdout.on('data', chunk => out.push(chunk)); owner.stderr.resume();
  assert.equal(await closed, 7); assert.equal(owner.backend, 'native'); assert.deepEqual(JSON.parse(Buffer.concat(out).toString()), values); assert.equal(fs.existsSync(cwd), false);
});

nativeTest('a workspace named local-engine-* survives when cleanup ownership was not granted', async t => {
  const cwd = folder(t), owner = spawnOwnedRuntime(process.execPath, ['-e', 'console.log("done");process.exitCode=7'], { cwd });
  const closed = new Promise(resolve => owner.once('close', resolve)); owner.stdout.resume(); owner.stderr.resume();
  assert.equal(await closed, 7); assert.equal(owner.backend, 'native'); assert.equal(fs.readFileSync(path.join(cwd, 'api-key'), 'utf8'), 'test-only-private-marker');
});

test('JavaScript compatibility ownership also preserves a workspace unless cleanup was granted', async t => {
  const cwd = folder(t), original = resolver.engineBinary; let owner;
  resolver.engineBinary = () => null;
  try { owner = spawnOwnedRuntime(process.execPath, ['-e', 'console.log("done");process.exitCode=7'], { cwd }); }
  finally { resolver.engineBinary = original; }
  const closed = new Promise(resolve => owner.once('close', resolve)); owner.stdout.resume(); owner.stderr.resume();
  assert.equal(await closed, 7); assert.equal(fs.readFileSync(path.join(cwd, 'api-key'), 'utf8'), 'test-only-private-marker');
});
