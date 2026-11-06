'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { releaseAssets } = require('../scripts/release-assets.cjs');
const pkg = require('../package.json');

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
