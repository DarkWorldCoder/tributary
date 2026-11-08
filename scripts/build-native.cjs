'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), crate = path.join(root, 'native/tributary-engine');
const binary = path.join(crate, 'target/release/tributary-engine' + (process.platform === 'win32' ? '.exe' : ''));
const target = { linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' }, darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' }, win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' } }[process.platform]?.[process.arch];
assert.ok(target, 'Native discovery supports x64 and arm64 on Linux, macOS and Windows.');
fs.rmSync(binary, { force: true });
// There are no registry dependencies. A build cannot fetch a new crate or change
// the lockfile; each distribution runner compiles its own native architecture.
execFileSync('cargo', ['build', '--locked', '--offline', '--release', '--target', target, '--manifest-path', path.join(crate, 'Cargo.toml')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: path.join(crate, 'target') },
});
fs.mkdirSync(path.dirname(binary), { recursive: true });
fs.copyFileSync(path.join(crate, 'target', target, 'release', path.basename(binary)), binary);
const identity = JSON.parse(execFileSync(binary, ['--identity'], { encoding: 'utf8', timeout: 10000, windowsHide: true }));
assert.deepEqual(identity, { protocol: 1, arch: process.arch === 'x64' ? 'x86_64' : 'aarch64', os: { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform] });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-build-'));
try {
  fs.writeFileSync(path.join(fixture, 'engine-probe.ts'), '');
  const lines = execFileSync(binary, ['scan-files', fixture, 'engine-probe', '1', 'true'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines, [{ protocol: 1 }, { file: 'engine-probe.ts' }, { complete: true, total: 1, visited: 1, unreadable: 0, limited: false }]);
  console.log(`Built native engine for ${process.platform}/${process.arch} (${fs.statSync(binary).size} bytes).`);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
