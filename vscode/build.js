'use strict';
// Packs the shared core and the built UI into vscode/dist so the extension is self-contained.
// usage: node vscode/build.js [--install]   (--install links it into ~/.vscode/extensions)
const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname; const root = path.join(here, '..');
const dist = path.join(here, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
const uiDist = path.join(root, 'ui', 'dist');
if (!fs.existsSync(path.join(uiDist, 'index.html'))) { console.error('Build the UI first: npm run build:ui'); process.exit(1); }
fs.cpSync(path.join(root, 'core'), path.join(dist, 'core'), { recursive: true });
fs.cpSync(uiDist, path.join(dist, 'ui'), { recursive: true });
fs.copyFileSync(path.join(here, 'bridge.js'), path.join(dist, 'ui', 'vscode-bridge.js'));
console.log(`Built ${path.relative(root, dist)}`);

if (process.argv.includes('--install')) {
  const pkg = require(path.join(here, 'package.json'));
  const target = path.join(os.homedir(), '.vscode', 'extensions', `${pkg.publisher}.${pkg.name}-${pkg.version}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(here, target, 'dir');
  console.log(`Linked into ${target}. Reload VS Code to activate it.`);
}
