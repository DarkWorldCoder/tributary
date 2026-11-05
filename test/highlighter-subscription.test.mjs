import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeHighlighter } from '../ui/src/lib/highlighter-subscription.mjs';
const tick = () => new Promise(setImmediate);

test('cancelling a highlight subscription skips an unstarted load and ignores late delivery', async () => {
  let loads = 0, deliveries = 0, resolve;
  const pending = new Promise(done => { resolve = done; });
  const before = subscribeHighlighter(() => { loads++; return pending; }, () => deliveries++); before(); before();
  await tick(); assert.equal(loads, 0);
  const started = subscribeHighlighter(() => { loads++; return pending; }, () => deliveries++);
  await tick(); assert.equal(loads, 1); started(); resolve('late grammar'); await tick();
  assert.equal(deliveries, 0);
});

test('a cancelled consumer does not abort a shared import used by a live consumer', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }); const values = [];
  const cancel = subscribeHighlighter(() => pending, value => values.push(['cancelled', value]));
  const live = subscribeHighlighter(() => pending, value => values.push(['live', value]));
  await tick(); cancel(); const grammar = { language: 'typescript' }; resolve(grammar); await tick(); live();
  assert.deepEqual(values, [['live', grammar]]);
});

test('failed or throwing loads and consumers settle without stale delivery or unhandled rejection', async () => {
  let deliveries = 0;
  subscribeHighlighter(() => { throw Error('sync load failure'); }, () => deliveries++);
  subscribeHighlighter(() => Promise.reject(Error('async load failure')), () => deliveries++);
  subscribeHighlighter(() => null, () => { deliveries++; throw Error('consumer failure'); });
  await tick(); await tick(); assert.equal(deliveries, 1);
});

test('pending promises and retained cleanups do not keep cancelled or completed subscriber owners alive', async () => {
  const { execFileSync } = await import('node:child_process'); const { fileURLToPath } = await import('node:url');
  const probe = fileURLToPath(new URL('../scripts/performance/highlighter-owner-probe.mjs', import.meta.url));
  const module = fileURLToPath(new URL('../ui/src/lib/highlighter-subscription.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', probe, module], { encoding: 'utf8', timeout: 15000 }));
  assert.deepEqual(result.cases.map(value => value.loads), [0, 1, 1, 1]);
  assert.deepEqual(result.cases.map(value => value.ownerReleased), [true, true, true, false]);
});
