'use strict';
// The desktop key store encrypts with the OS keychain. On Linux without a keyring Electron would fall back to
// "basic_text" (a fixed password), which is not treated as encryption: new keys stay in memory for the session.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopSecrets, storageKind } = require('../desktop/secrets');

const fake = (backend, available = true) => ({
  isEncryptionAvailable: () => available, getSelectedStorageBackend: () => backend,
  encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().replace(/^enc:/, ''),
});
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-keys-')), 'secrets.json');

test('a real keyring encrypts keys to disk; basic_text on Linux keeps them for the session only', async () => {
  assert.strictEqual(storageKind(fake('gnome_libsecret'), 'linux'), 'encrypted');
  assert.strictEqual(storageKind(fake('basic_text'), 'linux'), 'weak');
  assert.strictEqual(storageKind(fake('basic_text'), 'darwin'), 'encrypted', 'only Linux has that fallback');
  assert.strictEqual(storageKind(fake('unknown', false), 'linux'), 'session');

  const good = file(); const keyring = new DesktopSecrets(good, fake('kwallet6'), 'linux');
  await keyring.set('gw', 'sk-one');
  assert.match(fs.readFileSync(good, 'utf8'), /"enc"/);
  assert.strictEqual(await new DesktopSecrets(good, fake('kwallet6'), 'linux').get('gw'), 'sk-one');

  const weak = file(); const fallback = new DesktopSecrets(weak, fake('basic_text'), 'linux');
  await fallback.set('gw', 'sk-two');
  assert.strictEqual(await fallback.get('gw'), 'sk-two');
  assert.ok(!fs.existsSync(weak) || !fs.readFileSync(weak, 'utf8').includes('gw'), 'nothing written with a fixed password');
  // A key saved before still reads.
  fs.writeFileSync(weak, JSON.stringify({ old: { enc: Buffer.from('enc:sk-old').toString('base64') } }));
  assert.strictEqual(await new DesktopSecrets(weak, fake('basic_text'), 'linux').get('old'), 'sk-old');
});
