'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { nextVersion, applyVersion, planRelease, tagRelease, manifests } = require('../scripts/release-version.cjs');
const { publishRelease } = require('../scripts/publish-release.cjs');
const { releaseAssets, hashFile } = require('../scripts/release-assets.cjs');
const packageTag = 'v' + require('../package.json').version;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-auto-release-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Release test'); git(root, 'config', 'user.email', 'release-test@localhost');
  for (const file of manifests) { const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, JSON.stringify({ name: file, version: '0.1.4', ...(file.includes('lock') ? { packages: { '': { version: '0.1.4' } } } : {}) }, null, 2) + '\n'); }
  fs.writeFileSync(path.join(root, 'README.md'), 'Original documentation\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Source'); git(root, 'tag', 'v0.1.4'); return root;
}
test('version allocation is monotonic, accepts intentional major bumps and rejects unsafe versions', () => {
  assert.equal(nextVersion('0.1.4', ['v0.1.4', 'v0.1.3']), '0.1.5'); assert.equal(nextVersion('0.1.4', ['v0.1.9']), '0.1.10');
  assert.equal(nextVersion('1.0.0', ['v0.1.9']), '1.0.0'); assert.equal(nextVersion('0.1.4', []), '0.1.4');
  for (const bad of ['1.0.0;echo', '01.2.3', '1.0.65536']) assert.throws(() => nextVersion(bad, []));
  assert.throws(() => nextVersion('0.1.4', ['v1.0.65535']), /Windows/);
});
test('each source gets one reproducible version snapshot; retries reuse its tag and preserve main', t => {
  const root = fixture(t); fs.appendFileSync(path.join(root, 'README.md'), 'First push\n'); git(root, 'commit', '-qam', 'Push one');
  const source = git(root, 'rev-parse', 'HEAD'), plan = planRelease(root, source);
  assert.equal(plan.tag, 'v0.1.5'); applyVersion(root, plan.version);
  for (const file of manifests) assert.equal(JSON.parse(fs.readFileSync(path.join(root, file))).version, plan.version);
  const release = tagRelease(root, plan);
  assert.notEqual(release, source); assert.equal(git(root, 'rev-parse', 'HEAD'), source); assert.equal(git(root, 'rev-parse', release + '^'), source);
  assert.deepEqual(planRelease(root, source), plan); assert.equal(tagRelease(root, plan), release);
  git(root, 'reset', '--hard', source); fs.appendFileSync(path.join(root, 'README.md'), 'Second push\n'); git(root, 'commit', '-qam', 'Push two');
  assert.equal(planRelease(root, git(root, 'rev-parse', 'HEAD')).tag, 'v0.1.6');
  fs.appendFileSync(path.join(root, 'README.md'), 'Unexpected dirty source\n'); git(root, 'add', 'README.md');
  assert.throws(() => tagRelease(root, { ...plan, source: git(root, 'rev-parse', 'HEAD') }), /different content/);
});
test('manual builds resolve the exact tagged source and reject mismatched or unsafe tags', t => {
  const root = fixture(t), source = git(root, 'rev-parse', 'HEAD');
  const plan = planRelease(root, source, 'v0.1.4'); assert.equal(plan.automatic, false); assert.equal(plan.source, source);
  git(root, 'tag', 'v9.9.9'); assert.throws(() => planRelease(root, source, 'v9.9.9'), /match/);
  assert.throws(() => planRelease(root, source, '--all')); assert.throws(() => planRelease(root, 'main'));
});
function downloads(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-publish-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const version = require('../package.json').version;
  for (const platform of ['mac', 'win', 'linux']) for (const arch of ['x64', 'arm64']) for (const ext of platform === 'linux' ? ['AppImage', 'deb', 'tar.gz'] : platform === 'mac' ? ['dmg', 'zip'] : ['exe', 'zip']) {
    const suffix = platform === 'linux' && arch === 'x64' ? ext === 'deb' ? 'amd64' : ext === 'AppImage' ? 'x86_64' : arch : arch;
    fs.writeFileSync(path.join(dir, `Tributary-${version}-${platform}-${suffix}.${ext}`), 'Installer fixture');
  }
  releaseAssets(dir); return dir;
}
test('a release remains a draft until every installer and checksum is uploaded; a complete retry never overwrites downloads', t => {
  const dir = downloads(t), calls = []; let state = null;
  const run = args => {
    calls.push(args);
    if (args[1] === 'view') { if (!state) throw Error('release not found'); return JSON.stringify({ apiUrl: 'https://api.github.com/repos/example/tributary/releases/42' }); }
    if (args[0] === 'api') { assert.equal(args[1], 'https://api.github.com/repos/example/tributary/releases/42', 'tag lookup cannot read drafts'); return JSON.stringify(state); }
    if (args[1] === 'create') state = { draft: true, prerelease: true, assets: [], html_url: 'https://example.test/release' };
    if (args[1] === 'upload') state.assets = fs.readdirSync(dir).map(name => ({ name, state: 'uploaded', size: fs.statSync(path.join(dir, name)).size, digest: 'sha256:' + hashFile(path.join(dir, name)) }));
    if (args[1] === 'edit') state.draft = false;
    return '';
  };
  assert.equal(publishRelease(dir, packageTag, run).alreadyPublished, false);
  assert.equal(state.assets.length, 15); assert.ok(calls.find(call => call[1] === 'create').includes('--draft'));
  const before = calls.length; assert.equal(publishRelease(dir, packageTag, run).alreadyPublished, true);
  assert.equal(calls.length, before + 2);
  state.assets.pop(); assert.throws(() => publishRelease(dir, packageTag, run), /incomplete/);
});
test('failed uploads never publish and unexpected API failures are not treated as absent releases', t => {
  const dir = downloads(t); let edited = false;
  const run = args => { if (args[1] === 'view') return JSON.stringify({ apiUrl: 'https://api.github.com/repos/example/tributary/releases/42' }); if (args[0] === 'api') return JSON.stringify({ draft: true, prerelease: true, assets: [] }); if (args[1] === 'edit') edited = true; return ''; };
  assert.throws(() => publishRelease(dir, packageTag, run), /incomplete/); assert.equal(edited, false);
  assert.throws(() => publishRelease(dir, packageTag, () => { throw Error('HTTP 403 Forbidden'); }), /403/);
});
test('an existing uploaded draft is resolved by numeric API URL and resumed without recreation', t => {
  const dir = downloads(t), calls = [];
  const state = { draft: true, prerelease: true, assets: fs.readdirSync(dir).map(name => ({ name, state: 'uploaded', size: fs.statSync(path.join(dir, name)).size, digest: 'sha256:' + hashFile(path.join(dir, name)) })) };
  const run = args => {
    calls.push(args);
    if (args[1] === 'view') return JSON.stringify({ apiUrl: 'https://api.github.com/repos/example/tributary/releases/42' });
    if (args[0] === 'api') { assert.equal(args[1], 'https://api.github.com/repos/example/tributary/releases/42'); return JSON.stringify(state); }
    if (args[1] === 'create') throw Error('Draft already exists');
    if (args[1] === 'edit') state.draft = false;
    return '';
  };
  assert.equal(publishRelease(dir, packageTag, run).alreadyPublished, false);
  assert.equal(state.draft, false); assert.ok(!calls.some(args => args[1] === 'create'));
  state.draft = true;
  assert.throws(() => publishRelease(dir, packageTag, args => args[1] === 'edit' ? '' : run(args)), /remains a draft/);
});
test('same-size corrupted or unverifiable uploads cannot be published or accepted on retry', t => {
  const dir = downloads(t); let edits = 0;
  const state = { draft: true, prerelease: true, assets: fs.readdirSync(dir).map(name => ({ name, state: 'uploaded', size: fs.statSync(path.join(dir, name)).size, digest: 'sha256:' + hashFile(path.join(dir, name)) })) };
  const run = args => {
    if (args[1] === 'view') return JSON.stringify({ apiUrl: 'https://api.github.com/repos/example/tributary/releases/42' });
    if (args[0] === 'api') return JSON.stringify(state);
    if (args[1] === 'edit') edits++;
    return '';
  };
  state.assets[0].digest = 'sha256:' + '0'.repeat(64);
  assert.throws(() => publishRelease(dir, packageTag, run), /checksums/); assert.equal(edits, 0);
  state.draft = false; assert.throws(() => publishRelease(dir, packageTag, run), /checksums/); assert.equal(edits, 0);
  delete state.assets[0].digest; assert.throws(() => publishRelease(dir, packageTag, run), /checksums/);
});
