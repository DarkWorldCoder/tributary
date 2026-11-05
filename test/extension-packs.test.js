'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib'); const { mkdtemp } = require('./helpers/tmp');
const { ExtensionPacks, safePath } = require('../core/extension-packs');
test('imported themes keep focus accents separate from control borders and composer surfaces', async () => {
  const { extensionThemeVariables } = await import('../ui/src/lib/extension-theme-variables.mjs');
  const variables = extensionThemeVariables({ dark: true, colors: {
    'editor.background': '#2d2b55', 'editor.foreground': '#ffffff',
    'panel.border': '#fad000', 'editorWidget.border': '#fad000', 'focusBorder': '#fad000',
    'input.background': '#2d2b55', 'button.background': '#6c40ff', 'button.foreground': '#ffffff',
  }, tokenColors: [{ scope: 'string', foreground: '#a5ff90' }] });
  assert.equal(variables['--ring'], '#fad000');
  assert.equal(variables['--brand'], '#6c40ff');
  assert.equal(variables['--primary-foreground'], '#ffffff');
  assert.doesNotMatch(variables['--border'], /fad000/);
  assert.equal(variables['--input'], variables['--border']);
  assert.notEqual(variables['--card'], '#2d2b55');
  assert.match(variables['--card'], /color-mix/);
  assert.equal(variables['--syn-string'], '#a5ff90');
  const light = extensionThemeVariables({ dark: false, colors: {}, tokenColors: [] });
  assert.match(light['--card'], /#ffffff/);
  assert.equal(light['--card-foreground'], '#222222');
});
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

const { OpenVSX, registryURL } = require('../core/extension-registry');
const crypto = require('node:crypto');
function registry(body, overrides = {}) {
  const calls = [];
  const metadata = { namespace: 'fixture', name: 'studio', version: '1.0.0', files: { download: 'https://open-vsx.org/api/fixture/studio/1.0.0/file/fixture.vsix', sha256: 'https://open-vsx.org/api/fixture/studio/1.0.0/file/fixture.sha256' }, ...overrides };
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/latest')) return Response.json(metadata);
    if (String(url).endsWith('.sha256')) return new Response(crypto.createHash('sha256').update(body).digest('hex') + '  fixture.vsix');
    if (String(url).endsWith('.vsix')) return new Response(body);
    throw new Error('Unexpected URL');
  };
  return { fetcher, calls };
}
test('direct registry install checks package identity and checksum, imports appearance and removes the download', async () => {
  const root = mkdtemp('extension-registry'); const body = fs.readFileSync(fixture(root)); const remote = registry(body); const catalog = new OpenVSX(remote.fetcher); const packs = new ExtensionPacks(root); let downloaded;
  const result = await catalog.install('fixture.studio', (file, expected) => { downloaded = file; return packs.install(file, expected); });
  assert.equal(result.id, 'fixture.studio'); assert.equal((await packs.list()).length, 1); assert.equal(fs.existsSync(downloaded), false);
  assert.equal(remote.calls.length, 3); assert.equal((await packs.appearance(result.themes[0].id)).theme.colors['editor.background'], '#112233');
});
test('registry search is bounded, filters deprecated results and sends a theme category query', async () => {
  let requested;
  const catalog = new OpenVSX(async (url) => { requested = new URL(url); return Response.json({ extensions: [{ namespace: 'fixture', name: 'studio', displayName: 'Studio', description: 'Theme' }, { namespace: 'old', name: 'theme', deprecated: true }, { namespace: '../private', name: 'theme' }] }); });
  assert.deepEqual((await catalog.search('studio')).map((item) => item.id), ['fixture.studio']);
  assert.equal(requested.searchParams.get('category'), 'Themes'); assert.equal(requested.searchParams.get('size'), '24');
  await assert.rejects(catalog.search('x'.repeat(161)), /160/);
});
test('registry rejects untrusted download redirects, oversized content, and invalid checksums before import', async () => {
  for (const url of ['http://open-vsx.org/api/file', 'https://user:pass@open-vsx.org/api/file', 'https://open-vsx.org:444/api/file', 'https://127.0.0.1/file', 'https://open-vsx.org.attacker.test/file']) assert.throws(() => registryURL(url), /Untrusted/);
  const redirected = new OpenVSX(async () => new Response(null, { status: 302, headers: { location: 'https://localhost/private' } }));
  await assert.rejects(redirected.text('https://open-vsx.org/api/file', 1024, AbortSignal.timeout(1000)), /Untrusted/);
  const oversized = new OpenVSX(async () => new Response('abc', { headers: { 'content-length': '4096' } }));
  await assert.rejects(oversized.text('https://open-vsx.org/api/file', 16, AbortSignal.timeout(1000)), /size limit/);
  const chunked = new OpenVSX(async () => new Response('x'.repeat(20)));
  await assert.rejects(chunked.text('https://open-vsx.org/api/file', 16, AbortSignal.timeout(1000)), /size limit/);
  const body = Buffer.from('zip'); const remote = registry(body); const tampered = new OpenVSX((url, options) => String(url).endsWith('.vsix') ? Promise.resolve(new Response('different zip')) : remote.fetcher(url, options));
  let imported = false; await assert.rejects(tampered.install('fixture.studio', () => { imported = true; }), /checksum does not match/); assert.equal(imported, false); assert.equal(tampered.installing, false);
});
test('registry package mismatch preserves installed appearance and failed imports clean temporary files', async () => {
  const root = mkdtemp('extension-registry-mismatch'); const packs = new ExtensionPacks(root); const file = fixture(root); await packs.install(file);
  const body = fs.readFileSync(file); const remote = registry(body, { version: '2.0.0' }); const catalog = new OpenVSX(remote.fetcher); let downloaded;
  await assert.rejects(catalog.install('fixture.studio', (file, expected) => { downloaded = file; return packs.install(file, expected); }), /identity/);
  assert.equal(fs.existsSync(downloaded), false); assert.equal((await packs.list())[0].version, '1.0.0');
  await assert.rejects(catalog.install('../bad', () => {}), /extension ID/);
});
test('a newer catalog search cancels obsolete work and only one install can run at a time', async () => {
  let firstSignal;
  const catalog = new OpenVSX(async (url, { signal }) => {
    if (new URL(url).searchParams.get('query') === 'first') { firstSignal = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    return Response.json({ extensions: [] });
  });
  const first = catalog.search('first'); const rejected = assert.rejects(first);
  await catalog.search('second'); await rejected; assert.equal(firstSignal.aborted, true); assert.equal(catalog.searchController, null);
  let finish;
  const remote = registry(Buffer.from('archive'));
  const installing = new OpenVSX(remote.fetcher);
  const pending = installing.install('fixture.studio', () => new Promise((resolve) => { finish = resolve; }));
  await assert.rejects(installing.install('fixture.studio', () => {}), /current extension/);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  finish('installed'); assert.equal(await pending, 'installed'); assert.equal(installing.installing, false);
});
