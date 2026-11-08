import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFileWatchSession } from '../ui/src/lib/file-watch-session.mjs';
const { FileWatches } = createRequire(import.meta.url)('../core/file-watch');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const until = async (fn) => { const deadline = Date.now() + 3000; while (!fn()) { if (Date.now() > deadline) throw Error('Condition not reached'); await delay(5); } };
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-watch-'));
  for (const rel of ['src/a.ts', 'src/b.ts', 'other/c.ts']) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), rel); }
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
};
function native(t) {
  const original = fs.watch, handles = [];
  fs.watch = (dir, options, callback) => {
    const handle = { dir, callback, closed: false, close() { this.closed = true; }, on() {} }; handles.push(handle); return handle;
  };
  t.after(() => { fs.watch = original; }); return handles;
}

test('incremental paths keep directory handles and one ID while removed paths stop publishing', async t => {
  const root = fixture(t), handles = native(t), events = [], watches = new FileWatches(event => events.push(event)); t.after(() => watches.close());
  const id = await watches.start(root, ['src/a.ts']); assert.equal(handles.length, 2);
  assert.equal(await watches.replace(id, root, ['src/a.ts', 'src/b.ts']), id); assert.equal(handles.length, 2);
  const src = handles.find(handle => handle.dir === path.join(root, 'src'));
  src.callback('change', Buffer.from('a.ts')); // queued before removal
  await watches.replace(id, root, ['src/b.ts']); src.callback('change', null);
  await until(() => events.length); assert.deepEqual(events[0], { project: root, watchId: id, paths: ['src/b.ts'] });
  await watches.replace(id, root, ['other/c.ts']); assert.equal(src.closed, true); assert.equal(handles.length, 3);
  events.length = 0; src.callback('rename', 'a.ts'); await delay(200); assert.deepEqual(events, []);
  handles.find(handle => handle.dir === path.join(root, 'other')).callback('rename', 'unopened.ts');
  await until(() => events.length); assert.deepEqual(events[0].paths, [''], 'subdirectory invalidation survives path updates');
  watches.stop(id); assert.ok(handles.every(handle => handle.closed)); assert.equal(watches.watches.size, 0);
});

test('invalid updates keep the previous view intact and reject foreign view ownership', async t => {
  const root = fixture(t), handles = native(t), events = [], watches = new FileWatches(event => events.push(event)); t.after(() => watches.close());
  const id = await watches.start(root, ['src/a.ts']);
  await assert.rejects(watches.replace(id, root, ['../outside']), /outside project/);
  await assert.rejects(watches.replace(id, root, Array(25).fill('src/a.ts')), /24/);
  await assert.rejects(watches.replace(id, root + '-other', []), /Unknown live/);
  await assert.rejects(watches.replace('missing', root, []), /Unknown live/);
  assert.equal(handles.length, 2); assert.ok(handles.every(handle => !handle.closed));
  handles.find(handle => handle.dir === path.join(root, 'src')).callback('change', 'a.ts');
  await until(() => events.length); assert.deepEqual(events[0].paths, ['src/a.ts']);
});

test('pending starts reserve the capacity limit and close cannot resurrect them', async t => {
  const root = fixture(t), handles = native(t), gate = deferred(), original = fs.promises.realpath;
  fs.promises.realpath = async (...args) => { await gate.promise; return original(...args); };
  const watches = new FileWatches(() => {}); t.after(() => { fs.promises.realpath = original; gate.resolve(); watches.close(); });
  const pending = Array.from({ length: 16 }, () => watches.start(root, ['src/a.ts']));
  const settled = Promise.allSettled(pending);
  assert.equal(watches.watches.size, 16); await assert.rejects(watches.start(root, []), /Too many/);
  watches.close(); gate.resolve(); assert.ok((await settled).every(row => row.status === 'rejected'));
  assert.equal(watches.watches.size, 0); assert.equal(handles.length, 0);
  fs.promises.realpath = original; const id = await watches.start(root, []); assert.equal(typeof id, 'string'); watches.stop(id);
});

test('closing during initial stat releases already prepared native handles', async t => {
  const root = fixture(t), handles = native(t), gate = deferred(), original = fs.promises.stat;
  fs.promises.stat = async (...args) => { await gate.promise; return original(...args); };
  const watches = new FileWatches(() => {}); t.after(() => { fs.promises.stat = original; gate.resolve(); watches.close(); });
  const pending = watches.start(root, ['src/a.ts']); const rejected = assert.rejects(pending, /closed/);
  await until(() => handles.length === 2); watches.close(); assert.ok(handles.every(handle => handle.closed));
  gate.resolve(); await rejected; assert.equal(watches.watches.size, 0);
});

test('an in-flight update is bounded and shutdown prevents late additions', async t => {
  const root = fixture(t), handles = native(t), gate = deferred(), watches = new FileWatches(() => {});
  t.after(() => watches.close()); const id = await watches.start(root, ['src/a.ts']);
  const original = fs.promises.stat; fs.promises.stat = async (...args) => { await gate.promise; return original(...args); };
  t.after(() => { fs.promises.stat = original; gate.resolve(); });
  const pending = watches.replace(id, root, ['src/a.ts', 'other/c.ts']); const rejected = assert.rejects(pending, /closed/);
  await until(() => handles.length === 3);
  await assert.rejects(watches.replace(id, root, ['src/b.ts']), /in progress/);
  watches.stop(id); assert.ok(handles.every(handle => handle.closed)); gate.resolve(); await rejected;
  await assert.rejects(watches.replace(id, root, []), /Unknown live/);
});

test('polling follows added, removed and deleted paths when native events are unavailable', async t => {
  const root = fixture(t), original = fs.watch; fs.watch = () => { throw Error('Unsupported native watcher'); };
  const events = [], watches = new FileWatches(event => events.push(event)); t.after(() => { fs.watch = original; watches.close(); });
  const id = await watches.start(root, ['src/a.ts']); await watches.replace(id, root, ['src/b.ts']);
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'removed'); fs.writeFileSync(path.join(root, 'src/b.ts'), 'added');
  await until(() => events.some(event => event.paths.includes('src/b.ts'))); assert.ok(events.every(event => !event.paths.includes('src/a.ts')));
  events.length = 0; fs.unlinkSync(path.join(root, 'src/b.ts'));
  await until(() => events.some(event => event.paths.includes('src/b.ts'))); assert.equal(events[0].watchId, id);
});

function bridge() {
  const calls = [], listeners = new Set();
  return { calls, listeners, hub: { call(method, ...args) { const wait = deferred(); calls.push({ method, args, ...wait }); return wait.promise; }, on(event, fn) { assert.equal(event, 'files-changed'); listeners.add(fn); return () => listeners.delete(fn); } }, emit(event) { for (const fn of listeners) fn(event); } };
}
const setup = () => {
  const b = bridge(), status = [], refresh = [], directories = [];
  const session = createFileWatchSession(b.hub, '/project', { onStatus: value => status.push(value), onPaths: (paths, force) => refresh.push({ paths, force }), onDirectory: () => directories.push(true) });
  return { ...b, session, status, refresh, directories };
};
const turn = () => new Promise(setImmediate);

test('a file-pane session catches up only additions and retains one backend identity', async () => {
  const s = setup(); s.session.set(['a.ts']); s.calls[0].resolve('view'); await turn();
  s.session.set(['b.ts', 'a.ts', 'b.ts']); assert.deepEqual(s.calls[1].args, ['/project', ['a.ts', 'b.ts'], 'view']); s.calls[1].resolve('view'); await turn();
  s.session.set(['b.ts']); s.calls[2].resolve('view'); await turn();
  s.session.set(['b.ts']); await turn(); assert.equal(s.calls.length, 3);
  assert.deepEqual(s.refresh, [{ paths: ['a.ts'], force: false }, { paths: ['b.ts'], force: false }]);
  s.emit({ project: '/other', watchId: 'view', paths: ['b.ts'] }); s.emit({ project: '/project', watchId: 'foreign', paths: ['b.ts'] });
  assert.equal(s.refresh.length, 2);
  s.emit({ project: '/project', watchId: 'view', paths: ['', 'a.ts', 'b.ts'] });
  assert.deepEqual(s.refresh.at(-1), { paths: ['b.ts'], force: true }); assert.equal(s.directories.length, 1);
  s.session.dispose(); s.session.dispose(); await turn(); assert.equal(s.listeners.size, 0); assert.equal(s.calls.at(-1).method, 'unwatchFiles'); assert.deepEqual(s.calls.at(-1).args, ['view']);
});

test('rapid changes coalesce to the latest set without an unbounded update queue', async () => {
  const s = setup(); s.session.set(['first.ts']);
  for (let n = 0; n < 1000; n++) s.session.set(['latest' + n + '.ts']);
  assert.equal(s.calls.length, 1); s.calls[0].resolve('view'); await turn();
  assert.equal(s.calls.length, 2); assert.deepEqual(s.calls[1].args, ['/project', ['latest999.ts'], 'view']); assert.deepEqual(s.refresh, []);
  s.calls[1].resolve('view'); await turn(); assert.deepEqual(s.refresh, [{ paths: ['latest999.ts'], force: false }]); s.session.dispose();
});

test('pane replacement sends release before the next view requests admission', async () => {
  const s = setup(); s.session.set(['a.ts']); s.calls[0].resolve('view'); await turn();
  s.session.dispose();
  const next = createFileWatchSession(s.hub, '/project', { onStatus() {}, onPaths() {}, onDirectory() {} }); next.set(['b.ts']);
  assert.deepEqual(s.calls.map(call => call.method), ['watchFiles', 'unwatchFiles', 'watchFiles']);
  next.dispose(); s.calls[2].resolve('next'); await turn(); assert.deepEqual(s.calls[3].args, ['next']);
});

test('a failed registration catches up the latest files and a failed update keeps old events', async () => {
  const s = setup(); s.session.set(['a.ts']); s.calls[0].reject(Error('Unavailable')); await turn();
  assert.deepEqual(s.refresh, [{ paths: ['a.ts'], force: false }]); assert.equal(s.status.at(-1), 'Live updates unavailable');
  s.session.set(['a.ts', 'b.ts']); s.calls[1].resolve('view'); await turn();
  s.session.set(['a.ts', 'c.ts']); s.calls[2].reject(Error('Invalid addition')); await turn();
  assert.deepEqual(s.refresh.at(-1), { paths: ['c.ts'], force: false }); assert.equal(s.calls.length, 3, 'failure must not spin-retry');
  s.emit({ project: '/project', watchId: 'view', paths: ['a.ts', 'b.ts'] }); assert.deepEqual(s.refresh.at(-1), { paths: ['a.ts'], force: true }); s.session.dispose();
});

test('older bridges may return a new watch ID and require a complete catch-up', async () => {
  const s = setup(); s.session.set(['a.ts']); s.calls[0].resolve('old'); await turn();
  s.session.set(['a.ts', 'b.ts']); s.calls[1].resolve('new'); await turn();
  assert.deepEqual(s.refresh.at(-1), { paths: ['a.ts', 'b.ts'], force: false });
  assert.equal(s.calls[2].method, 'unwatchFiles'); assert.deepEqual(s.calls[2].args, ['old']);
  s.session.dispose(); await turn(); assert.deepEqual(s.calls[3].args, ['new']);
});

test('disposing a connecting pane or updating pane releases late IDs without callbacks', async () => {
  for (const replacement of [null, 'same', 'different']) {
    const s = setup(); s.session.set(['a.ts']);
    if (replacement) { s.calls[0].resolve('same'); await turn(); s.session.set(['b.ts']); }
    const pending = s.calls.at(-1), count = s.refresh.length; s.session.dispose(); pending.resolve(replacement || 'late'); await turn();
    assert.equal(s.refresh.length, count); assert.equal(s.listeners.size, 0);
    const ids = s.calls.filter(call => call.method === 'unwatchFiles').map(call => call.args[0]);
    assert.deepEqual(ids.sort(), replacement === 'different' ? ['different', 'same'] : [replacement || 'late']);
    s.session.set(['ignored.ts']); assert.equal(s.calls.filter(call => call.method === 'watchFiles').length, replacement ? 2 : 1);
  }
});

test('a pending connection and retained cleanup do not keep a disposed pane callback owner alive', () => {
  const fixture = fileURLToPath(new URL('./fixtures/file-watch-owner.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fixture], { encoding: 'utf8', timeout: 15000 }));
  assert.deepEqual(result, { releasedWhilePending: true, releasedAfterCompletion: true });
});
