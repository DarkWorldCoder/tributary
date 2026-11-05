'use strict';
// Open VSX is the vendor-neutral registry for VS Code-compatible packages.
// Catalog and download URLs stay on the registry and its public asset CDN.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ID = /^[a-z\d][a-z\d_-]{0,100}\.[a-z\d][a-z\d_.-]{0,100}$/i;
const LIMIT = 80 * 1024 * 1024;
function registryURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['open-vsx.org', 'openvsx.eclipsecontent.org'].includes(url.hostname)) throw new Error('Untrusted extension download URL.');
  return url;
}
class OpenVSX {
  constructor(fetcher = globalThis.fetch) { this.fetch = fetcher; this.installing = false; }
  async response(value, signal, redirects = 0) {
    const url = registryURL(value);
    const response = await this.fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Tributary extension browser', Accept: '*/*' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects >= 3 || !response.headers.get('location')) throw new Error('Too many extension download redirects.');
      return this.response(new URL(response.headers.get('location'), url), signal, redirects + 1);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 404 ? 'Extension not found in Open VSX.' : `Open VSX request failed (${response.status}). Try again.`); }
    return response;
  }
  async consume(url, limit, signal, write) {
    const response = await this.response(url, signal);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty extension download.');
    let bytes = 0;
    try {
      if (Number(response.headers.get('content-length')) > limit) throw new Error('Extension download exceeds the size limit.');
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > limit) throw new Error('Extension download exceeds the size limit.');
        await write(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async text(url, limit, signal) { const chunks = []; await this.consume(url, limit, signal, (part) => { chunks.push(Buffer.from(part)); }); return Buffer.concat(chunks).toString('utf8'); }
  async json(url, signal) { return JSON.parse(await this.text(url, 2 * 1024 * 1024, signal)); }
  async search(query = '') {
    if (typeof query !== 'string' || query.length > 160) throw new Error('Search must be 160 characters or fewer.');
    const params = new URLSearchParams({ query: query.trim(), category: 'Themes', size: '24', sortBy: query.trim() ? 'relevance' : 'downloadCount', sortOrder: 'desc' });
    this.searchController?.abort();
    const controller = new AbortController(); this.searchController = controller;
    try {
      const result = await this.json(`https://open-vsx.org/api/-/search?${params}`, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      return (Array.isArray(result.extensions) ? result.extensions : []).slice(0, 24).filter((item) => ID.test(`${item.namespace}.${item.name}`) && !item.deprecated).map((item) => ({
        id: `${item.namespace}.${item.name}`, name: String(item.displayName || item.name).slice(0, 160), description: String(item.description || '').slice(0, 400), publisher: String(item.namespace), version: String(item.version || '').slice(0, 80), downloads: Number.isFinite(item.downloadCount) ? item.downloadCount : 0,
      }));
    } finally { if (this.searchController === controller) this.searchController = null; }
  }
  async install(id, importer) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Use an extension ID such as GitHub.github-vscode-theme.');
    if (this.installing) throw new Error('Wait for the current extension installation to finish.');
    this.installing = true; let dir;
    try {
      const signal = AbortSignal.timeout(120000);
      const [publisher, ...name] = id.split('.');
      const meta = await this.json(`https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name.join('.'))}/latest`, signal);
      if (`${meta.namespace}.${meta.name}`.toLowerCase() !== id.toLowerCase() || typeof meta.version !== 'string' || meta.deprecated) throw new Error('Registry returned a different or unavailable extension.');
      if (!meta.files?.download || !meta.files.sha256) throw new Error('Extension download or checksum is missing.');
      const checksum = await this.text(meta.files.sha256, 1024, signal);
      const expected = checksum.trim().match(/^([a-f\d]{64})(?:\s|$)/i)?.[1];
      if (!expected) throw new Error('Invalid extension checksum.');
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tributary-extension-'));
      const file = path.join(dir, 'package.vsix'); const handle = await fs.open(file, 'wx', 0o600); const hash = crypto.createHash('sha256');
      try { await this.consume(meta.files.download, LIMIT, signal, async (part) => { hash.update(part); await handle.writeFile(part); }); }
      finally { await handle.close(); }
      if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) throw new Error('Extension checksum does not match. Nothing was installed.');
      return await importer(file, { id: id.toLowerCase(), version: meta.version });
    } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); this.installing = false; }
  }
}
module.exports = { OpenVSX, registryURL };
