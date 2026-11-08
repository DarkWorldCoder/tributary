'use strict';
const fs = require('node:fs'), path = require('node:path');

// Only Tributary's own built/packaged executable is eligible. Never select an
// arbitrary PATH program or a workspace-supplied executable.
function engineBinary({ resourcesPath = process.resourcesPath, coreDirectory = __dirname, platform = process.platform } = {}) {
  const name = 'tributary-engine' + (platform === 'win32' ? '.exe' : '');
  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'native-engine', name));
  candidates.push(path.resolve(coreDirectory, '../native/tributary-engine/target/release', name));
  for (const file of candidates) {
    try { if (fs.lstatSync(file).isFile()) return file; } catch {}
  }
  return null;
}

async function discoverFiles(root, query, options) {
  const binary = engineBinary();
  if (!binary) return null;
  return require('./native-engine/discovery.cjs').nativeScan(binary, root, query, options);
}
module.exports = { engineBinary, discoverFiles };
