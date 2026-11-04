'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib'); const { mkdtemp } = require('./helpers/tmp');
const { ExtensionPacks, safePath } = require('../core/extension-packs');
// Small stored ZIPs keep the parser tests independent of external zip programs.
function zip(files) {
  const chunks = []; const directory = []; let offset = 0;
  for (const [name, value] of files) {
    const filename = Buffer.from(name); const body = Buffer.from(value); const crc = zlib.crc32(body); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26); chunks.push(local, filename, body);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42); directory.push(central, filename); offset += local.length + filename.length + body.length;
  }
  const data = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(data.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...chunks, data, end]);
}
function fixture(root, overrides = {}) {
  const manifest = { name: 'studio', publisher: 'fixture', displayName: 'Fixture Studio', version: '1.0.0', main: './extension.js', contributes: { themes: [{ label: 'Fixture Night', uiTheme: 'vs-dark', path: './themes/dark.json' }], iconThemes: [{ id: 'fixture', label: 'Fixture Icons', path: './icons/theme.json' }] } };
  const files = { 'extension/package.json': JSON.stringify(manifest), 'extension/extension.js': 'throw new Error("Must never execute")', 'extension/themes/base.json': '{"colors":{"editor.foreground":"#eeeeee"}}', 'extension/themes/dark.json': '{ // comment\n "include":"./base.json", "colors":{"editor.background":"#112233"}, "tokenColors":[{"scope":"keyword","settings":{"foreground":"#ff7766"}}], }', 'extension/icons/theme.json': JSON.stringify({ iconDefinitions: { js: { iconPath: './js.svg' } }, fileExtensions: { js: 'js', ts: 'js' }, folder: 'js' }), 'extension/icons/js.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#55bb88" d="M1 1h14v14H1z"/></svg>', ...overrides };
  const file = path.join(root, 'fixture.vsix'); fs.writeFileSync(file, zip(Object.entries(files))); return file;
}
test('VSIX packs import declarative color themes and image icons without executing extension code', async () => {
  const root = mkdtemp('extension-packs'); const packs = new ExtensionPacks(root); const result = await packs.install(fixture(root));
  assert.equal(result.hasRuntime, true); assert.equal(result.themes[0].label, 'Fixture Night');
  const appearance = await packs.appearance(result.themes[0].id, result.iconThemes[0].id);
  assert.equal(appearance.theme.colors['editor.foreground'], '#eeeeee'); assert.equal(appearance.theme.colors['editor.background'], '#112233'); assert.match(appearance.icons.definitions.js.image, /^data:image\/svg\+xml;base64,/);
  assert.equal((await packs.list()).length, 1); assert.equal(fs.existsSync(path.join(root, 'extension.js')), false);
  await packs.remove(result.id); assert.equal((await packs.list()).length, 0);
});
test('VSIX import rejects traversal, active SVG resources, duplicate entries and include cycles', async () => {
  const root = mkdtemp('extension-untrusted'); const packs = new ExtensionPacks(root);
  for (const value of ['../../private', '/etc/passwd', 'https://example.test/icon.svg', '..\\private']) assert.throws(() => safePath('extension/package.json', value), /Invalid|escapes/);
  await assert.rejects(packs.install(fixture(root, { 'extension/icons/js.svg': '<svg><script>alert(1)</script></svg>' })), /active or external/);
  await assert.rejects(packs.install(fixture(root, { 'extension/themes/base.json': '{"include":"./dark.json"}' })), /cycle/);
  const file = path.join(root, 'duplicate.vsix'); fs.writeFileSync(file, zip([['extension/package.json', '{}'], ['extension/package.json', '{}']])); await assert.rejects(packs.install(file), /Duplicate/);
});
module.exports = { zip, fixture };
