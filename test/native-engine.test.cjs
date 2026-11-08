'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { engineBinary } = require('../core/native-engine');

test('native executable resolution stays inside the installed app or its own build tree', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-resolution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resourcesPath = path.join(root, 'resources'), coreDirectory = path.join(root, 'core');
  const resolve = platform => engineBinary({ resourcesPath, coreDirectory, platform });
  assert.equal(resolve('linux'), null);
  const local = path.join(root, 'native/tributary-engine/target/release/tributary-engine');
  fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, 'local fixture');
  assert.equal(resolve('linux'), local);
  assert.equal(resolve('win32'), null, 'do not launch a binary for another OS');
  const installed = path.join(resourcesPath, 'native-engine/tributary-engine');
  fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.writeFileSync(installed, 'installed fixture');
  assert.equal(resolve('linux'), installed, 'installed resources take precedence');
  fs.rmSync(installed); fs.mkdirSync(installed);
  assert.equal(resolve('linux'), local, 'directories are never executable candidates');
  if (process.platform !== 'win32') {
    fs.rmSync(installed, { recursive: true }); fs.symlinkSync(local, installed);
    assert.equal(resolve('linux'), local, 'a redirected installed path is not selected');
  }
  fs.writeFileSync(local + '.exe', 'Windows fixture');
  assert.equal(resolve('win32'), local + '.exe');
});

test('the integrated filename path uses native results and preserves complete Unicode fallback', async t => {
  if (!engineBinary()) { t.skip('The source-only checkout has no compiled engine; CI builds it before this test.'); return; }
  const scanner = require('../core/filename-search'), bridge = require('../core/native-engine/discovery.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const responses = [], original = bridge.nativeScan;
  t.mock.method(bridge, 'nativeScan', async (...args) => { const value = await original(...args); responses.push(value); return value; });
  fs.mkdirSync(path.join(root, 'src'));
  for (let at = 0; at < 2600; at++) fs.closeSync(fs.openSync(path.join(root, 'src', `source-${String(at).padStart(6, '0')}.ts`), 'w'));
  const options = { limit: 7 };
  assert.deepEqual(await scanner.scanFileNames(root, 'SOURCE-', options), await scanner.scanFileNamesJS(root, 'SOURCE-', options));
  assert.equal(responses.length, 1); assert.equal(responses[0].total, 2600, 'the real engine completed the whole walk');
  fs.writeFileSync(path.join(root, 'src', '日本語.ts'), '');
  assert.deepEqual(await scanner.scanFileNames(root, 'source-', options), await scanner.scanFileNamesJS(root, 'source-', options));
  assert.equal(responses.at(-1), null, 'an unsupported relative name falls back without using partial native output');
  assert.deepEqual((await scanner.scanFileNames(root, '日本語')).files, ['src/日本語.ts']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(scanner.scanFileNames(root, 'source', { signal: controller.signal }), { name: 'AbortError' });
});
