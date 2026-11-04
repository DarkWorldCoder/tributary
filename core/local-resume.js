'use strict';
// One bounded, private network checkpoint per chat. No provider credentials are stored.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const networkFailure = (error) => /cannot reach|timed?\s*out|fetch failed|terminated|socket|\b(?:ECONN\w*|ENET\w*|EHOSTUNREACH|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_\w+))\b|network|\boffline\b|connection (?:ended|closed|reset|refused|lost|aborted)|HTTP (?:408|502|503|504)|reconnecting|routing discovery failed/i.test(String(error || ''));
const location = (dir, id) => path.join(dir, 'local-resume', `${crypto.createHash('sha256').update(String(id)).digest('hex')}.json`);
function save(dir, id, value) {
  const data = JSON.stringify(value); if (Buffer.byteLength(data) > 2 * 1024 * 1024) throw new Error('Resume context exceeded the 2 MB limit.');
  const file = location(dir, id); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}`;
  try { fs.writeFileSync(temp, data, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
}
function read(dir, id) { try { const file = location(dir, id); if (fs.statSync(file).size > 2 * 1024 * 1024) return null; return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function remove(dir, id) { fs.rmSync(location(dir, id), { force: true }); }
module.exports = { networkFailure, save, read, remove };
