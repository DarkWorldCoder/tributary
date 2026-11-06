import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageVisibility, imagePlaceholder } from '../ui/src/lib/image-visibility.mjs';

test('one observer tracks entering and leaving images and releases only closed targets', () => {
  const made = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; made.push(this); }
    observe(element) { this.targets.add(element); }
    unobserve(element) { this.targets.delete(element); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  }
  const manager = createImageVisibility(Observer), a = {}, b = {}, seen = [];
  const offA = manager.observe(a, value => seen.push(['a', value])), offB = manager.observe(b, value => seen.push(['b', value]));
  assert.equal(made.length, 1); assert.deepEqual(made[0].options, { rootMargin: '200px' });
  made[0].callback([{ target: a, isIntersecting: true }, { target: a, isIntersecting: false }, { target: b, isIntersecting: true }]);
  assert.deepEqual(seen, [['a', true], ['a', false], ['b', true]]);
  offA(); offA(); made[0].callback([{ target: a, isIntersecting: true }]); assert.equal(seen.length, 3);
  assert.equal(made[0].disconnected, false); offB(); assert.equal(made[0].disconnected, true); assert.deepEqual(manager.state(), { targets: 0, observing: false });
  const offAgain = manager.observe(a, () => {}); assert.equal(made.length, 2); offAgain();
});

test('unsupported or unavailable observers keep content accessible without retaining targets', () => {
  for (const Observer of [null, class { constructor() { throw Error('Unavailable'); } }]) {
    const manager = createImageVisibility(Observer), values = [], off = manager.observe({}, value => values.push(value));
    assert.deepEqual(values, [true]); off(); assert.deepEqual(manager.state(), { targets: 0, observing: false });
  }
});

test('late observations cannot update a replacement owner; shared target subscribers get current visibility', () => {
  const observers = [];
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} unobserve() {} disconnect() {} }
  const manager = createImageVisibility(Observer), element = {}, other = {}, values = [];
  const off = manager.observe(element, value => values.push(value)), offOther = manager.observe(other, () => {});
  observers[0].callback([{ target: element, isIntersecting: true }]);
  const shared = []; const offShared = manager.observe(element, value => shared.push(value)); assert.deepEqual(shared, [true]);
  off(); offShared(); const replace = manager.observe(element, value => values.push(value));
  observers[0].callback([{ target: element, time: 0, isIntersecting: false }]); assert.deepEqual(values, [true]);
  replace(); offOther();
  const next = manager.observe(element, value => values.push(value)); observers[0].callback([{ target: element, isIntersecting: false }]); assert.deepEqual(values, [true]);
  observers[1].callback([{ target: element, isIntersecting: true }]); assert.deepEqual(values, [true, true]); next();
});

test('placeholder intrinsic dimensions cap height without upscaling or keeping file payloads', () => {
  assert.deepEqual(imagePlaceholder(4000, 1000), { width: 1024, height: 256, viewBox: '0 0 4000 1000' });
  assert.deepEqual(imagePlaceholder(1000, 4000), { width: 64, height: 256, viewBox: '0 0 1000 4000' });
  assert.deepEqual(imagePlaceholder(32, 32), { width: 32, height: 32, viewBox: '0 0 32 32' });
  for (const [w, h] of [[0, 1], [1, 0], [NaN, 1], [1, Infinity]]) assert.equal(imagePlaceholder(w, h), null);
});
