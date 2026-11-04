'use strict';
// Import declarative theme/icon contributions only. VSIX entrypoints and scripts
// are never extracted or run. Only referenced, bounded assets enter the cache.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const yauzl = require('yauzl'); const { parse } = require('jsonc-parser');
const COLOR = /^#[\da-f]{3,8}$/i;
const json = (buffer) => { const errors = []; const value = parse(buffer.toString('utf8'), errors, { allowTrailingComma: true }); if (errors.length || !value || typeof value !== 'object') throw new Error('Invalid extension JSON.'); return value; };
function safePath(base, rel) {
  if (typeof rel !== 'string' || /[\\\0]/.test(rel) || path.posix.isAbsolute(rel) || /^[a-z]+:/i.test(rel)) throw new Error('Invalid extension asset path.');
  const name = path.posix.normalize(path.posix.join(path.posix.dirname(base), rel));
  if (!name.startsWith('extension/')) throw new Error('Extension asset escapes its package.');
  return name;
}
async function readVsix(filename) {
  if (fs.statSync(filename).size > 80 * 1024 * 1024) throw new Error('Choose a VSIX smaller than 80 MB.');
  const zip = await new Promise((resolve, reject) => yauzl.open(filename, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  const entries = new Map(); let size = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', (entry) => {
        size += entry.uncompressedSize;
        if (entries.size > 15000 || size > 200 * 1024 * 1024 || entry.uncompressedSize > 20 * 1024 * 1024 || entry.generalPurposeBitFlag & 1 || entry.fileName.includes('\\') || entry.fileName.split('/').includes('..') || entry.fileName.startsWith('/')) return reject(new Error('Unsupported or oversized VSIX archive.'));
        if (entries.has(entry.fileName)) return reject(new Error('Duplicate VSIX asset.'));
        entries.set(entry.fileName, entry); zip.readEntry();
      }); zip.readEntry();
    });
    let readBytes = 0; const cache = new Map();
    const read = async (name) => {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name); if (!entry) throw new Error(`Missing extension asset: ${name}`);
      readBytes += entry.uncompressedSize; if (readBytes > 64 * 1024 * 1024) throw new Error('Referenced extension assets exceed 64 MB.');
      const buffer = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error); const chunks = []; let actual = 0;
        stream.on('data', (chunk) => { actual += chunk.length; if (actual > entry.uncompressedSize || actual > 20 * 1024 * 1024) { stream.destroy(); reject(new Error('Invalid VSIX asset size.')); } else chunks.push(chunk); }); stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks)));
      })); cache.set(name, buffer); return buffer;
    };
    const manifest = json(await read('extension/package.json'));
    if (!/^[a-z\d][a-z\d_.-]{0,100}$/i.test(manifest.publisher || '') || !/^[a-z\d][a-z\d_.-]{0,100}$/i.test(manifest.name || '')) throw new Error('Invalid extension identity.');
    const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
    const loadTheme = async (name, seen = new Set()) => { if (seen.has(name) || seen.size >= 8) throw new Error('Theme include cycle or depth limit.'); seen.add(name); const own = json(await read(name)); const base = own.include ? await loadTheme(safePath(name, own.include), seen) : {}; return { colors: { ...base.colors, ...own.colors }, tokenColors: [...(base.tokenColors || []), ...(Array.isArray(own.tokenColors) ? own.tokenColors : [])] }; };
    const themes = [];
    for (const [index, contribution] of (manifest.contributes?.themes || []).slice(0, 100).entries()) {
      const data = await loadTheme(safePath('extension/package.json', contribution.path));
      themes.push({ id: `${id}:theme:${index}`, label: String(contribution.label || contribution.id || manifest.displayName || manifest.name).slice(0, 160), dark: !['vs', 'hc-light'].includes(contribution.uiTheme), colors: Object.fromEntries(Object.entries(data.colors).filter(([, color]) => typeof color === 'string' && COLOR.test(color))), tokenColors: data.tokenColors.filter((rule) => rule && rule.settings && COLOR.test(rule.settings.foreground || '')).slice(0, 3000).map((rule) => ({ scope: typeof rule.scope === 'string' ? rule.scope : Array.isArray(rule.scope) ? rule.scope.filter((scope) => typeof scope === 'string') : undefined, foreground: rule.settings.foreground })) });
    }
    let assetBytes = 0;
    const asset = async (base, rel) => {
      const name = safePath(base, rel); const ext = path.extname(name).toLowerCase(); const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }[ext];
      if (!mime) throw new Error('Unsupported icon asset type.');
      const data = await read(name); assetBytes += data.length; if (assetBytes > 48 * 1024 * 1024) throw new Error('Icon assets exceed 48 MB.');
      if (ext === '.svg' && /<\s*(script|foreignObject)|<!ENTITY|<!DOCTYPE|(?:href|src)\s*=\s*["']\s*(?:https?:|file:)|url\(\s*["']?https?:/i.test(data.toString('utf8'))) throw new Error('Icon contains unsupported active or external content.');
      return `data:${mime};base64,${data.toString('base64')}`;
    };
    const iconThemes = [];
    for (const [index, contribution] of (manifest.contributes?.iconThemes || []).slice(0, 40).entries()) {
      const name = safePath('extension/package.json', contribution.path); const data = json(await read(name));
      const fonts = [];
      for (const font of (data.fonts || []).slice(0, 10)) {
        const source = font.src?.find((src) => /\.(woff2?|ttf)$/i.test(src.path || ''));
        if (source) fonts.push({ id: String(font.id), data: await asset(name, source.path) });
      }
      const definitions = Object.create(null);
      for (const [key, def] of Object.entries(data.iconDefinitions || {}).slice(0, 10000)) {
        if (!def || typeof def !== 'object') continue;
        if (def.iconPath) definitions[key] = { image: await asset(name, def.iconPath) };
        else if (typeof def.fontCharacter === 'string') {
          const char = /^\\[\da-f]{1,6}$/i.test(def.fontCharacter) ? String.fromCodePoint(Math.min(0x10ffff, parseInt(def.fontCharacter.slice(1), 16))) : def.fontCharacter.slice(0, 4);
          definitions[key] = { char, font: String(def.fontId || fonts[0]?.id || ''), color: COLOR.test(def.fontColor || '') ? def.fontColor : undefined };
        }
      }
      const associations = (source) => Object.fromEntries(['file', 'folder', 'folderExpanded', 'rootFolder', 'rootFolderExpanded', 'fileExtensions', 'fileNames', 'folderNames', 'folderNamesExpanded', 'languageIds'].filter((key) => source?.[key] != null).map((key) => [key, typeof source[key] === 'string' ? source[key] : Object.fromEntries(Object.entries(source[key] || {}).filter(([, value]) => typeof value === 'string').map(([name, value]) => [name.toLowerCase(), value]))]));
      iconThemes.push({ id: `${id}:icons:${index}`, label: String(contribution.label || contribution.id || manifest.displayName || manifest.name).slice(0, 160), definitions, fonts, associations: associations(data), light: associations(data.light), highContrast: associations(data.highContrast) });
    }
    if (!themes.length && !iconThemes.length) throw new Error('This VSIX has no color themes or file-icon packs. Configure language tools separately.');
    return { id, name: String(manifest.displayName || manifest.name).slice(0, 160), publisher: manifest.publisher, version: String(manifest.version || ''), themes, iconThemes, hasRuntime: !!(manifest.main || manifest.browser) };
  } finally { zip.close(); }
}
class ExtensionPacks {
  constructor(dir) { this.dir = path.join(dir, 'extension-packs'); }
  filename(id) { if (typeof id !== 'string' || !/^[a-z\d][a-z\d_.-]{0,201}$/i.test(id)) throw new Error('Invalid extension pack.'); return path.join(this.dir, `${id}.json`); }
  async install(filename) { const pack = await readVsix(filename); await fs.promises.mkdir(this.dir, { recursive: true }); const file = this.filename(pack.id); const temp = `${file}.${crypto.randomUUID()}.tmp`; await fs.promises.writeFile(temp, JSON.stringify(pack), { mode: 0o600 }); await fs.promises.rename(temp, file); return this.summary(pack); }
  summary(pack) { return { id: pack.id, name: pack.name, publisher: pack.publisher, version: pack.version, hasRuntime: pack.hasRuntime, themes: pack.themes.map(({ id, label, dark }) => ({ id, label, dark })), iconThemes: pack.iconThemes.map(({ id, label }) => ({ id, label })) }; }
  async read(id) { const file = this.filename(id); if ((await fs.promises.stat(file)).size > 100 * 1024 * 1024) throw new Error('Invalid extension cache.'); return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  async list() { const names = await fs.promises.readdir(this.dir).catch(() => []); const packs = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.read(name.slice(0, -5)).then((pack) => this.summary(pack)).catch(() => null))); return packs.filter(Boolean); }
  async appearance(themeId, iconsId) { const load = async (id, key) => { if (!id) return null; const packId = id.split(':')[0]; return (await this.read(packId))[key].find((item) => item.id === id) || null; }; return { theme: await load(themeId, 'themes'), icons: await load(iconsId, 'iconThemes') }; }
  async remove(id) { await fs.promises.rm(this.filename(id), { force: true }); }
}
module.exports = { ExtensionPacks, readVsix, safePath };
