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
    const mime = imageMime(bytes) || ((/^(?:Makefile|GNUmakefile|Dockerfile|README|LICENSE|\.gitignore|\.editorconfig)$/i.test(path.basename(file.name)) || /\.(txt|md|markdown|json|jsonc|csv|tsv|log|ya?ml|[cm]?[jt]sx?|py|rs|go|html?|css|xml|toml|sql|sh|c|h|cc|cpp|cxx|hpp|cs|java|kt|kts|swift|rb|php|zig|ex|exs|erl|hrl|hs|lua|r|R|scala|sc|dart|pl|pm|ps1|bat|cmd|vue|svelte|scss|less|ini|conf|cfg|properties|graphql|gql|proto|tf|hcl)$/i.test(file.name)) && !bytes.includes(0) ? 'text/plain' : 'application/octet-stream');
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
function locate(dataDir, id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment.');
  const dir = directory(dataDir), metadata = path.join(dir, id + '.json'), stat = fs.lstatSync(metadata);
  if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid attachment metadata.');
  const meta = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (meta.id !== id || !new RegExp(`^${id}\\.[a-z0-9]{1,12}$`).test(meta.file)) throw new Error('Invalid attachment metadata.');
  return { meta, file: path.join(dir, meta.file) };
}
function read(dataDir, id) {
  const { meta, file } = locate(dataDir, id); const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Attachment is unavailable.');
  const bytes = fs.readFileSync(file); const { file: stored, ...publicMeta } = meta;
  return { ...publicMeta, path: file, base64: bytes.toString('base64') };
}
async function preview(dataDir, id, { preview: kind, bytesOnly = false } = {}) {
  if (!['image', 'text'].includes(kind)) throw new Error('Invalid attachment preview.');
  const { meta, file } = locate(dataDir, id);
  if (kind === 'text' ? meta.mime !== 'text/plain' : !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(meta.mime)) throw new Error('This attachment has no supported preview.');
  // Stored attachments are regular private files, never links to user paths.
  const entry = await fs.promises.lstat(file); if (!entry.isFile()) throw new Error('Attachment is unavailable.');
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let stat, buffer, written = 0;
  try {
    stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Attachment is unavailable.');
    buffer = Buffer.allocUnsafeSlow(Math.min(stat.size, kind === 'text' ? 256 * 1024 : MAX_FILE));
    while (written < buffer.length) { const { bytesRead } = await handle.read(buffer, written, buffer.length - written, written); if (!bytesRead) break; written += bytesRead; }
  } finally { await handle.close(); }
  const publicMeta = { id: meta.id, name: meta.name, mime: meta.mime }, bytes = buffer.subarray(0, written);
  if (kind === 'text') return { ...publicMeta, size: stat.size, content: bytes.toString('utf8'), truncated: stat.size > written };
  return { ...publicMeta, size: stat.size, ...(bytesOnly === true ? { bytes: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : { base64: bytes.toString('base64') }) };
}
function resolve(dataDir, ids = []) {
  if (!Array.isArray(ids) || ids.length > 8) throw new Error('Attach up to 8 files.');
  const files = [...new Set(ids)].map((id) => read(dataDir, id));
  if (files.reduce((n, file) => n + file.size, 0) > MAX_TOTAL) throw new Error('Attachments exceed 32 MB.');
  return files;
}
module.exports = { add, read, preview, resolve, imageMime };
