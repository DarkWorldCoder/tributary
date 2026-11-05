import test from 'node:test';
import assert from 'node:assert/strict';
import { documentDirty, retainDocumentDrafts } from '../ui/src/lib/document-cache.mjs';

const entry = (content = 'saved') => ({ saved: { title: 'Title', content, history: [{ content: 'old version' }] }, title: 'Title', content });

test('document cache releases clean hidden versions while retaining the visible entry and every dirty draft', () => {
  const visible = entry(); const clean = entry('x'.repeat(1000000));
  const body = { ...entry(), content: 'unsaved body' }; const title = { ...entry(), title: 'Unsaved title' };
  const all = { visible, clean, body, title };
  const next = retainDocumentDrafts(all, 'visible');
  assert.deepEqual(Object.keys(next), ['visible', 'body', 'title']);
  assert.strictEqual(next.visible, visible); assert.strictEqual(next.body, body); assert.strictEqual(next.title, title);
  assert.strictEqual(all.clean, clean, 'pruning must not mutate the previous React state');
  assert.equal(documentDirty(undefined), false); assert.equal(documentDirty(clean), false);
  assert.equal(documentDirty(body), true); assert.equal(documentDirty(title), true);
});

test('close, late save and discard release only entries that no longer contain unsaved work', () => {
  const all = { one: entry('one'), two: { ...entry('two'), content: 'dirty' } };
  const closed = retainDocumentDrafts(all, '');
  assert.deepEqual(Object.keys(closed), ['two']);
  const saved = { ...closed, two: entry('dirty') };
  assert.deepEqual(retainDocumentDrafts(saved, ''), {}, 'a save completing after close must not re-retain a clean hidden entry');
  assert.deepEqual(retainDocumentDrafts({ ...closed, another: entry('another') }, 'another'), { ...closed, another: entry('another') });
  assert.deepEqual(retainDocumentDrafts({}, ''), {});
});

test('repeated document switching keeps at most the current clean entry plus pinned drafts', () => {
  let entries = { dirty: { ...entry(), content: 'keep this draft' } };
  for (let index = 0; index < 100; index++) {
    const key = `document-${index}`;
    entries = retainDocumentDrafts({ ...entries, [key]: entry(`saved-${index}`) }, key);
    assert.equal(Object.keys(entries).length, 2);
    assert.equal(entries.dirty.content, 'keep this draft');
  }
  assert.deepEqual(Object.keys(retainDocumentDrafts(entries, '')), ['dirty']);
});

test('cache maintenance preserves object identity when nothing can be released', () => {
  const entries = { current: entry(), dirty: { ...entry(), title: 'changed' } };
  assert.strictEqual(retainDocumentDrafts(entries, 'current'), entries);
  const empty = {}; assert.strictEqual(retainDocumentDrafts(empty, ''), empty);
});
