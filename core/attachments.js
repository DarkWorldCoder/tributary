'use strict';
const fs = require('node:fs'); const path = require('node:path'); const { randomUUID } = require('node:crypto');
const MAX_FILE = 16 * 1024 * 1024; const MAX_TOTAL = 32 * 1024 * 1024;
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function directory(dataDir) { const dir = path.join(dataDir, 'attachments'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
function add(dataDir, files) {
  if (!Array.isArray(files) || !files.length || files.length > 8) throw new Error('Attach up to 8 files at a time.');
  let total = 0;
  const decoded = files.map((file) => {
    if (typeof file.name !== 'string' || typeof file.base64 !== 'string' || file.base64.length > Math.ceil(MAX_FILE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw new Error('Invalid attachment or file exceeds 16 MB.');
    const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
    if (!bytes.length || bytes.length > MAX_FILE || total > MAX_TOTAL) throw new Error('Files must be under 16 MB each and 32 MB total.');
    const mime = imageMime(bytes) || (/\.(txt|md|markdown|json|jsonc|csv|tsv|log|ya?ml|[cm]?[jt]sx?|py|rs|go|html?|css|xml|toml|sql|sh)$/i.test(file.name) && !bytes.includes(0) ? 'text/plain' : 'application/octet-stream');
    return { bytes, name: path.basename(file.name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'Attachment', mime };
  });
  const dir = directory(dataDir);
  return decoded.map(({ bytes, name, mime }) => {
    const id = randomUUID(); const originalExtension = path.extname(name).toLowerCase(); const safeExtension = /^\.[a-z0-9]{1,12}$/.test(originalExtension) ? originalExtension : '.bin'; const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'text/plain': safeExtension === '.bin' ? '.txt' : safeExtension }[mime] || safeExtension;
    const meta = { id, name, mime, size: bytes.length, file: id + extension };
    fs.writeFileSync(path.join(dir, meta.file), bytes, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta), { mode: 0o600, flag: 'wx' });
    const { file, ...publicMeta } = meta; return publicMeta;
  });
}
function read(dataDir, id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment.');
  const dir = directory(dataDir); const meta = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  if (meta.id !== id || !new RegExp(`^${id}\\.[a-z0-9]{1,12}$`).test(meta.file)) throw new Error('Invalid attachment metadata.');
  const file = path.join(dir, meta.file); const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Attachment is unavailable.');
  const bytes = fs.readFileSync(file); const { file: stored, ...publicMeta } = meta;
  return { ...publicMeta, path: file, base64: bytes.toString('base64') };
}
function resolve(dataDir, ids = []) {
  if (!Array.isArray(ids) || ids.length > 8) throw new Error('Attach up to 8 files.');
  const files = [...new Set(ids)].map((id) => read(dataDir, id));
  if (files.reduce((n, file) => n + file.size, 0) > MAX_TOTAL) throw new Error('Attachments exceed 32 MB.');
  return files;
}
module.exports = { add, read, resolve, imageMime };
