'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const version = require('../package.json').version;
function hashFile(full) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), fd = fs.openSync(full, 'r');
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function releaseAssets(directory) {
directory = path.resolve(directory);
const files = fs.readdirSync(directory).filter((file) => /\.(?:dmg|zip|exe|AppImage|deb|tar\.gz)$/.test(file)).sort();
for (const platform of ['mac', 'win', 'linux']) for (const arch of ['x64', 'arm64']) {
  const formats = platform === 'mac' ? ['dmg', 'zip'] : platform === 'win' ? ['exe', 'zip'] : ['AppImage', 'deb', 'tar.gz'];
  for (const ext of formats) {
    const artifactArch = platform === 'linux' && arch === 'x64' ? ext === 'AppImage' ? 'x86_64' : ext === 'deb' ? 'amd64' : arch : arch;
    if (!files.includes(`Tributary-${version}-${platform}-${artifactArch}.${ext}`)) throw new Error(`Missing ${platform}/${arch} ${ext} download`);
  }
}
if (files.length !== 14) throw new Error('Expected exactly 14 release downloads; remove stale or unexpected artifacts');
const lines = files.map((file) => {
  const full = path.join(directory, file); if (!fs.statSync(full).isFile() || !fs.statSync(full).size) throw new Error(`Empty release asset: ${file}`);
  return `${hashFile(full)}  ${file}`;
});
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
return files.length;
}
module.exports = { releaseAssets, hashFile };
if (require.main === module) console.log(`Verified ${releaseAssets(process.argv[2] || 'release-assets')} release files; SHA256SUMS.txt generated.`);
