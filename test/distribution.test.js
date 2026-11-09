'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { releaseAssets } = require('../scripts/release-assets.cjs');
const { execFileSync } = require('node:child_process');
const { nativeLicenses } = require('../scripts/native-licenses.cjs');
const pkg = require('../package.json');

test('native license bytes survive a Windows-style Git checkout without weakening verification', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-notice-checkout-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repository = path.join(dir, 'repo'); const crate = 'native/tributary-engine'; fs.mkdirSync(path.join(repository, crate), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', crate, 'Cargo.lock'), path.join(repository, crate, 'Cargo.lock'));
  fs.cpSync(path.join(__dirname, '..', crate, 'licenses'), path.join(repository, crate, 'licenses'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false', ...args], { cwd: repository, stdio: 'pipe', windowsHide: true });
  git('init', '-q'); git('add', '--all');
  const converted = path.join(dir, 'converted'); fs.mkdirSync(converted);
  git('checkout-index', '--all', `--prefix=${converted.replaceAll('\\', '/')}/`);
  assert.throws(() => nativeLicenses(path.join(converted, crate)), /Native license text changed/);
  fs.copyFileSync(path.join(__dirname, '..', '.gitattributes'), path.join(repository, '.gitattributes')); git('add', '.gitattributes');
  const preserved = path.join(dir, 'preserved'); fs.mkdirSync(preserved);
  git('checkout-index', '--all', `--prefix=${preserved.replaceAll('\\', '/')}/`);
  const notices = nativeLicenses(path.join(preserved, crate));
  for (const file of notices.files) assert.deepEqual(fs.readFileSync(path.join(notices.root, file)), fs.readFileSync(path.join(repository, crate, 'licenses', file)));
  const license = path.join(notices.root, 'errno-0.3.14/LICENSE-MIT'); fs.appendFileSync(license, '\nmodified');
  assert.throws(() => nativeLicenses(path.join(preserved, crate)), /Native license text changed/);
});

test('release publication requires all six platform/architecture builds and hashes exact download bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-release-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => releaseAssets(dir), /Missing mac\/x64/);
  const files = [];
  for (const platform of ['mac', 'win', 'linux']) for (const arch of ['x64', 'arm64']) {
    for (const ext of platform === 'mac' ? ['dmg', 'zip'] : platform === 'win' ? ['exe', 'zip'] : ['AppImage', 'deb', 'tar.gz']) {
      const artifactArch = platform === 'linux' && arch === 'x64' ? ext === 'AppImage' ? 'x86_64' : ext === 'deb' ? 'amd64' : arch : arch;
      const file = `Tributary-${pkg.version}-${platform}-${artifactArch}.${ext}`; files.push(file); fs.writeFileSync(path.join(dir, file), 'download bytes: ' + file);
    }
  }
  fs.writeFileSync(path.join(dir, files[0]), Buffer.alloc(131075, 0x83)); // Cross multiple 64 KiB checksum reads.
  assert.equal(releaseAssets(dir), 14);
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n'); assert.equal(sums.length, 14);
  for (const file of files) assert.ok(sums.includes(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex') + '  ' + file));
  const stale = path.join(dir, 'Tributary-old-win-x64.exe'); fs.writeFileSync(stale, 'stale'); assert.throws(() => releaseAssets(dir), /exactly 14/); fs.unlinkSync(stale);
  fs.unlinkSync(path.join(dir, files.at(-1))); assert.throws(() => releaseAssets(dir), /Missing linux\/arm64/);
});

test('installer configuration preserves data and includes external formatter and terminal runtime', () => {
  assert.equal(pkg.build.npmRebuild, false); assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  for (const file of ['core/search-worker.cjs', 'core/files.js', 'core/directory-page.js']) assert.ok(pkg.build.asarUnpack.includes(file));
  assert.ok(pkg.build.files.includes('LICENSE')); assert.ok(pkg.build.asarUnpack.includes('core/format-worker.cjs')); assert.ok(pkg.build.asarUnpack.includes('node_modules/@lydell/**'));
  assert.deepEqual(pkg.build.mac.target, ['dmg', 'zip']); assert.deepEqual(pkg.build.win.target, ['nsis', 'zip']); assert.deepEqual(pkg.build.linux.target, ['AppImage', 'deb', 'tar.gz']);
});
