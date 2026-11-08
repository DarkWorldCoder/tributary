import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFileRequests } from '../ui/src/lib/file-request.mjs';

const request = (project, n = 1) => ({ project, rel: 'main.ts', intent: 'pinned', n });

test('one latest file intent is available before its pane mounts and snapshots stay stable', () => {
  const store = createFileRequests(), first = request('/one'), last = request('/other', 2);
  assert.equal(store.getSnapshot('/one'), null);
  store.publish(first); assert.equal(store.getSnapshot('/one'), first); assert.equal(store.getSnapshot(['/extra', '/one']), first);
  let calls = 0; const off = store.subscribe('/one', () => calls++);
  assert.equal(store.getSnapshot('/one'), first); assert.equal(store.getSnapshot('/one'), first);
  store.publish(first); assert.equal(calls, 0, 'the same object remains the same snapshot');
  store.publish(last); assert.equal(calls, 1); assert.equal(store.getSnapshot('/one'), null); assert.equal(store.getSnapshot('/other'), last);
  off();
});

test('a request notifies only its old/new folders and a multi-root router once', () => {
  const store = createFileRequests(), counts = { one: 0, two: 0, other: 0, router: 0 };
  const offs = Object.entries({ one: '/one', two: '/two', other: '/other', router: ['/one', '/two', '/one'] })
    .map(([name, roots]) => store.subscribe(roots, () => counts[name]++));
  store.publish(request('/one')); assert.deepEqual(counts, { one: 1, two: 0, other: 0, router: 1 });
  store.publish(request('/two', 2)); assert.deepEqual(counts, { one: 2, two: 1, other: 0, router: 2 });
  store.publish(request('/two', 3)); assert.deepEqual(counts, { one: 2, two: 2, other: 0, router: 3 });
  for (const off of offs) off();
});

test('reopening the same path is a new focus intent and preserves all navigation flags', () => {
  const store = createFileRequests(), seen = [];
  store.subscribe('/one', () => seen.push(store.getSnapshot('/one')));
  for (let n = 1; n <= 20; n++) store.publish({ ...request('/one', n), line: n, column: 3, editor: true, following: n % 2 === 0, intent: n % 2 ? 'pinned' : 'preview' });
  assert.equal(seen.length, 20);
  assert.deepEqual(seen.at(-1), { ...request('/one', 20), line: 20, column: 3, editor: true, following: true, intent: 'preview' });
});

test('unsubscription is idempotent, cancels queued callbacks, and allows later subscriptions', () => {
  const store = createFileRequests(); let removed = 0, late = 0, offRemoved, offLate;
  const offFirst = store.subscribe('/one', () => { offRemoved(); offLate ??= store.subscribe('/one', () => late++); });
  offRemoved = store.subscribe('/one', () => removed++);
  store.publish(request('/one')); assert.equal(removed, 0); assert.equal(late, 0);
  store.publish(request('/one', 2)); assert.equal(late, 1);
  offRemoved(); offFirst(); offLate(); offLate();
  store.publish(request('/one', 3)); assert.equal(late, 1);
  let remounted = 0; const off = store.subscribe('/one', () => remounted++);
  store.publish(request('/one', 4)); assert.equal(remounted, 1); off();
});

test('a nested publication leaves the newest intent authoritative', () => {
  const store = createFileRequests(), next = request('/two', 2); let moved = false;
  store.subscribe('/one', () => { if (!moved) { moved = true; store.publish(next); } });
  store.publish(request('/one'));
  assert.equal(store.getSnapshot('/one'), null); assert.equal(store.getSnapshot('/two'), next);
});

test('independent app-store owners do not share requests or listeners', () => {
  const a = createFileRequests(), b = createFileRequests(); let count = 0;
  b.subscribe('/one', () => count++); a.publish(request('/one'));
  assert.equal(count, 0); assert.equal(b.getSnapshot('/one'), null);
});

test('retained cleanup functions release subscriber owners and overwritten requests', () => {
  const fixture = fileURLToPath(new URL('./fixtures/file-request-owner.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fixture], { encoding: 'utf8', timeout: 15000 }));
  assert.deepEqual(result, { subscriberReleased: true, previousReleased: true, latestRetained: true });
});
