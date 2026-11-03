'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const language = import('../ui/src/lib/document-language.mjs');
test('live JSON validation checks syntax and basic package fields, including unsaved text', async () => {
  const { validateDocument } = await language;
  assert.equal((await validateDocument('bad.json', '{"x":}'))[0].severity, 'error');
  const result = await validateDocument('package.json', '{"private":"yes","scripts":{"test":3}}');
  assert.equal(result.length, 2); assert.ok(result.every((d) => d.source === 'JSON' && d.column > 1));
  assert.deepEqual(await validateDocument('package.json', '{"private":true,"scripts":{"test":"node --test"}}'), []);
});
test('JSONC and tsconfig allow comments and trailing commas; schemas never fetch remotely', async () => {
  const { validateDocument } = await language;
  const text = '{ // comment\n "compilerOptions": {},\n}';
  assert.deepEqual(await validateDocument('settings.jsonc', text), []);
  assert.deepEqual(await validateDocument('tsconfig.build.json', text), []);
  assert.ok((await validateDocument('strict.json', text)).length);
  assert.deepEqual(await validateDocument('remote.json', '{"$schema":"https://invalid.example/schema","safe":true}'), []);
});
test('CSS-family validation uses the matching parser and rejects unsupported or oversized documents', async () => {
  const { validateDocument, DOCUMENT_LIMIT } = await language;
  const result = await validateDocument('src/style.css', 'a { colr: red; }');
  assert.equal(result[0].column, 5); assert.equal(result[0].severity, 'warning');
  assert.deepEqual(await validateDocument('style.scss', '$a:red; a { color:$a; }'), []);
  assert.deepEqual(await validateDocument('style.less', '@a:red; a { color:@a; }'), []);
  assert.deepEqual(await validateDocument('main.go', 'invalid'), []);
  assert.deepEqual(await validateDocument('large.json', '['.repeat(DOCUMENT_LIMIT + 1)), []);
});
test('HTML, CSS and package.json completions provide bounded text edits without snippet placeholders', async () => {
  const { completeDocument } = await language;
  for (const [path, text, label] of [['page.html', '<di', 'div'], ['style.css', 'a { col', 'color'], ['package.json', '{ "pri', 'private']]) {
    const options = await completeDocument(path, text, text.length); const item = options.find((o) => o.label === label);
    assert.ok(item, `${path}: ${label}`); assert.ok(item.from >= 0 && item.to <= text.length);
    assert.ok(!/\$\d|\$\{\d/.test(item.text));
  }
  const schema = (await completeDocument('other.json', '{ "', 3)).find((o) => o.label.includes('$schema'));
  assert.ok(schema); assert.ok(!schema.text.includes('\\$'));
});
