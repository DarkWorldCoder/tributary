'use strict';
// API keys: encrypted with the OS keychain (Keychain, DPAPI, libsecret/kwallet) when available. On Linux with no
// keyring running, Electron falls back to "basic_text", which encrypts with a fixed password; that is not treated as
// encryption, so new keys are then kept only for this session. Keys saved earlier still read.
const fs = require('fs');
const path = require('path');

/** 'encrypted', 'weak' (Linux basic_text) or 'session' (no encryption at all). */
function storageKind(safeStorage, platform = process.platform) {
  if (!safeStorage.isEncryptionAvailable()) return 'session';
  if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return 'weak';
  return 'encrypted';
}

class DesktopSecrets {
  constructor(file, safeStorage, platform = process.platform) {
    this.file = file; this.safeStorage = safeStorage; this.platform = platform; this.session = new Map();
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; }
  }
  get kind() { return storageKind(this.safeStorage, this.platform); }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 }); }
  async get(k) {
    if (this.session.has(k)) return this.session.get(k);
    const v = this.data[k]; if (!v) return undefined;
    return v.enc ? this.safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v.plain;
  }
  async set(k, value) {
    if (this.kind === 'encrypted') { this.data[k] = { enc: this.safeStorage.encryptString(value).toString('base64') }; this.session.delete(k); }
    else { this.session.set(k, value); delete this.data[k]; }
    this.save();
  }
  async delete(k) { delete this.data[k]; this.session.delete(k); this.save(); }
}

module.exports = { DesktopSecrets, storageKind };
