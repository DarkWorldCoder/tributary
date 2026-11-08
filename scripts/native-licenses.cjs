'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
function nativeLicenses(crate) {
  const root = path.join(crate, 'licenses'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const field = (block, name) => new RegExp('^' + name + ' = "([^"]+)"$', 'm').exec(block)?.[1];
  const locked = fs.readFileSync(path.join(crate, 'Cargo.lock'), 'utf8').split('[[package]]').filter(block => field(block, 'checksum')).map(block => Object.fromEntries(['name', 'version', 'checksum', 'source'].map(key => [key, field(block, key)])));
  assert.deepEqual(manifest.packages.map(({ licenses, ...pkg }) => pkg), locked, 'Native dependency notices must match Cargo.lock.');
  const files = ['manifest.json'];
  for (const pkg of manifest.packages) {
    assert.match(pkg.name, /^[a-zA-Z0-9_-]+$/); assert.match(pkg.version, /^[0-9.]+$/);
    const directory = pkg.name + '-' + pkg.version;
    assert.ok(fs.lstatSync(path.join(root, directory)).isDirectory());
    assert.ok(Object.keys(pkg.licenses).length, 'Every native dependency needs its license text.');
    for (const [name, expected] of Object.entries(pkg.licenses)) {
      assert.equal(path.posix.dirname(name), directory); assert.match(path.posix.basename(name), /^[a-zA-Z0-9_.-]+$/);
      const file = path.join(root, name); assert.ok(fs.lstatSync(file).isFile());
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, 'Native license text changed: ' + name);
      files.push(name);
    }
  }
  const actual = fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile()).map(name => name.replaceAll('\\', '/')).sort();
  assert.deepEqual(actual, [...files].sort(), 'Unexpected native notice files must not enter the installer.');
  return { root, files };
}
module.exports = { nativeLicenses };
