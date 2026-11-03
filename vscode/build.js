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
// The shared core loads age on demand. Copy its production dependency tree so an
// installed extension can create team keys without the source checkout nearby.
function copyDependency(name, from, modules) {
  let source = path.dirname(require.resolve(name, { paths: [from] }));
  while (!fs.existsSync(path.join(source, 'package.json')) || JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name !== name) {
    const parent = path.dirname(source);
    if (parent === source) throw new Error(`Cannot locate runtime package ${name}`);
    source = parent;
  }
  const target = path.join(modules, name);
  fs.cpSync(source, target, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies || {})) copyDependency(dependency, source, path.join(target, 'node_modules'));
}
copyDependency('age-encryption', root, path.join(dist, 'node_modules'));
console.log(`Built ${path.relative(root, dist)}`);

if (process.argv.includes('--install')) {
  const pkg = require(path.join(here, 'package.json'));
  const target = path.join(os.homedir(), '.vscode', 'extensions', `${pkg.publisher}.${pkg.name}-${pkg.version}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(here, target, 'dir');
  console.log(`Linked into ${target}. Reload VS Code to activate it.`);
}
