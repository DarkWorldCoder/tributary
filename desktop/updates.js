'use strict';
// Installer updates use the same release assets and SHA256SUMS as manual downloads.
// No renderer-supplied URL, shared GitHub credential or unattended installer execution.
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = 'DarkWorldCoder/tributary';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}`;
const TOKEN_KEY = 'desktop:updates:github';
const MAX_INSTALLER = 2 * 1024 ** 3;
const TRUSTED_HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function version(value) {
  if (typeof value !== 'string' || value.length > 150) return null;
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?)$/.exec(value);
  return match?.[1] || null;
}
function compareVersions(a, b) {
  const parts = (input) => { const [base, ...pre] = version(input).split('-'); return { base: base.split('.').map(BigInt), pre: pre.join('-').split('.').filter(Boolean) }; };
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < 3; i++) if (x.base[i] !== y.base[i]) return x.base[i] > y.base[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return Number(!x.pre.length) - Number(!y.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const a = x.pre[i]; const b = y.pre[i]; if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const an = /^\d+$/.test(a); const bn = /^\d+$/.test(b);
    if (an && bn) { if (BigInt(a) === BigInt(b)) continue; return BigInt(a) > BigInt(b) ? 1 : -1; }
    if (an !== bn) return an ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}
function installerName(ver, platform, arch, appImage = false) {
  if (!version(ver) || !['x64', 'arm64'].includes(arch)) return null;
  if (platform === 'win32') return `Tributary-${ver}-win-${arch}.exe`;
  if (platform === 'darwin') return `Tributary-${ver}-mac-${arch}.dmg`;
  if (platform === 'linux') return `Tributary-${ver}-linux-${appImage ? arch === 'x64' ? 'x86_64' : arch : arch === 'x64' ? 'amd64' : arch}.${appImage ? 'AppImage' : 'deb'}`;
  return null;
}
function releaseFor(releases, current, platform, arch, appImage) {
  if (!Array.isArray(releases) || !version(current)) throw new Error('The update service returned invalid release information.');
  const latest = releases.filter((release) => !release.draft && version(release.tag_name)).sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  if (!latest || compareVersions(latest.tag_name, current) <= 0) return null;
  const ver = version(latest.tag_name); const name = installerName(ver, platform, arch, appImage);
  const assets = Array.isArray(latest.assets) ? latest.assets : [];
  const asset = assets.find((item) => item.name === name); const sums = assets.find((item) => item.name === 'SHA256SUMS.txt');
  const valid = (item, max) => item && Number.isSafeInteger(item.id) && item.id > 0 && Number.isSafeInteger(item.size) && item.size > 0 && item.size <= max;
  if (!valid(asset, MAX_INSTALLER) || !valid(sums, 1024 ** 2)) throw new Error('This release does not yet have a complete installer for this computer. Open the release downloads or try again later.');
  return { version: ver, asset, sums, url: `${RELEASES}/tag/${encodeURIComponent(latest.tag_name)}`, notes: typeof latest.body === 'string' ? latest.body.slice(0, 12000) : '' };
}
function checksumFor(text, name) {
  const hashes = String(text).split(/\r?\n/).map((line) => /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line)).filter((match) => match?.[2] === name);
  if (hashes.length !== 1) throw new Error('The release checksum is missing or ambiguous. Download refused.');
  return hashes[0][1].toLowerCase();
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class AppUpdates extends EventEmitter {
  constructor({ app, secrets, fetch, shell, platform = process.platform, arch = process.arch, appImage = !!process.env.APPIMAGE, beforeInstall = () => {} }) {
    super(); Object.assign(this, { app, secrets, fetch, shell, platform, arch, appImage, beforeInstall });
    this.settingsFile = path.join(app.getPath('userData'), 'updates.json');
    let settings; try { settings = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch {}
    this.data = { currentVersion: app.getVersion(), platform, arch, packaged: app.isPackaged, status: 'idle', latestVersion: null, releaseUrl: RELEASES, notes: '', fileName: '', percent: 0, transferred: 0, total: 0, checkedAt: null, error: '', autoCheck: settings?.autoCheck === true, hasToken: false, storage: secrets.kind, appImage, installerOpened: false };
  }
  state() { return { ...this.data }; }
  change(patch) { Object.assign(this.data, patch); this.emit('state', this.state()); return this.state(); }
  async init() { this.data.hasToken = !!await this.secrets.get(TOKEN_KEY).catch(() => null); this.schedule(); return this.state(); }
  schedule() {
    clearTimeout(this.startTimer); clearInterval(this.interval);
    if (!this.app.isPackaged || !this.data.autoCheck) return;
    const check = () => { if (!this.controller && !this.ready) void this.check().catch(() => {}); };
    this.startTimer = setTimeout(check, 30000); this.startTimer.unref?.();
    this.interval = setInterval(check, 6 * 60 * 60 * 1000); this.interval.unref?.();
  }
  async configure(input = {}) {
    if (this.controller) throw new Error('Wait for the update check or download to finish.');
    if (input.token !== undefined) {
      if (typeof input.token !== 'string' || !/^[\w-]{20,512}$/.test(input.token.trim())) throw new Error('Enter a valid GitHub access token.');
      await this.secrets.set(TOKEN_KEY, input.token.trim()); this.data.hasToken = true;
    }
    if (input.clearToken === true) { await this.secrets.delete(TOKEN_KEY); this.data.hasToken = false; }
    if (typeof input.autoCheck === 'boolean') {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
      fs.writeFileSync(this.settingsFile, JSON.stringify({ autoCheck: input.autoCheck }), { mode: 0o600 });
      this.data.autoCheck = input.autoCheck; this.schedule();
    }
    return this.change({ storage: this.secrets.kind, error: '' });
  }
  async request(url, token, signal, accept = 'application/vnd.github+json') {
    // Follow only GitHub's HTTPS asset redirects; never forward the token to its CDN.
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !TRUSTED_HOSTS.has(parsed.hostname)) throw new Error('The update service returned an untrusted download address.');
      const headers = { Accept: accept, 'User-Agent': 'Tributary-Updater', 'X-GitHub-Api-Version': '2022-11-28' };
      if (token && parsed.hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
      const response = await this.fetch(parsed.href, { headers, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('The update download redirect was incomplete.');
        url = new URL(location, parsed).href; continue;
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) { await response.body?.cancel(); throw new Error('GitHub access is required or its rate limit was reached. Add a token with Contents: read access to DarkWorldCoder/tributary, or open downloads in your browser.'); }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`The update service is unavailable (${response.status}). Try again later.`); }
      return response;
    }
    throw new Error('Too many update download redirects.');
  }
  async read(response, max) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('The update service returned too much data.'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async operation(action) {
    if (this.controller) throw new Error('An update operation is already running.');
    const controller = this.controller = new AbortController();
    let finish; this.finished = new Promise((resolve) => { finish = resolve; });
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000); timeout.unref?.();
    try { return await action(controller.signal); }
    catch (error) {
      // Raw HTTP errors can include signed URLs or credentials. Only our fixed messages cross IPC.
      const message = error?.message || '';
      this.change({ status: this.ready ? 'ready' : this.cancelled ? this.release ? 'available' : 'idle' : 'error', error: this.cancelled ? '' : /^(?:GitHub access|The update|The release|This release|The downloaded|Download |Too many|Stop |Save )/.test(message) ? message : 'The update could not finish. Check your connection and try again.' });
      return this.state();
    } finally { clearTimeout(timeout); this.controller = null; this.cancelled = false; finish(); }
  }
  async check() {
    if (this.ready) return this.state();
    return this.operation(async (signal) => {
      this.change({ status: 'checking', error: '', percent: 0 }); this.release = null;
      const token = await this.secrets.get(TOKEN_KEY);
      const releases = JSON.parse(await this.read(await this.request(`${API}/releases?per_page=30`, token, signal), 2 * 1024 ** 2));
      this.release = releaseFor(releases, this.data.currentVersion, this.platform, this.arch, this.appImage);
      const release = this.release;
      return this.change({ status: release ? 'available' : 'current', checkedAt: Date.now(), latestVersion: release?.version || null, releaseUrl: release?.url || RELEASES, notes: release?.notes || '', fileName: release?.asset.name || '', total: release?.asset.size || 0, transferred: 0 });
    });
  }
  async download() {
    if (this.ready) return this.state();
    if (!this.release) throw new Error('Check for updates before downloading.');
    return this.operation(async (signal) => {
      const release = this.release; const token = await this.secrets.get(TOKEN_KEY);
      this.change({ status: 'downloading', error: '', percent: 0, transferred: 0 });
      const sums = await this.read(await this.request(`${API}/releases/assets/${release.sums.id}`, token, signal, 'application/octet-stream'), 1024 ** 2);
      const hash = checksumFor(sums, release.asset.name);
      if (release.asset.digest && release.asset.digest !== `sha256:${hash}`) throw new Error('The release checksums disagree. Download refused.');
      const dir = await fs.promises.mkdtemp(path.join(this.app.getPath('temp'), 'tributary-update-'));
      this.downloadDir = dir;
      const target = path.join(dir, release.asset.name); let handle;
      try {
        const response = await this.request(`${API}/releases/assets/${release.asset.id}`, token, signal, 'application/octet-stream');
        handle = await fs.promises.open(target, 'wx', 0o600);
        const digest = crypto.createHash('sha256'); let total = 0; let lastEvent = 0;
        for await (const chunk of response.body) {
          if (signal.aborted) throw new Error('Download cancelled.');
          total += chunk.length; if (total > release.asset.size) throw new Error('The downloaded installer is larger than expected. Download refused.');
          digest.update(chunk); await handle.writeFile(chunk);
          if (Date.now() - lastEvent >= 200) { lastEvent = Date.now(); this.change({ transferred: total, percent: Math.floor(total / release.asset.size * 100) }); }
        }
        if (signal.aborted) throw new Error('Download cancelled.');
        if (total !== release.asset.size || digest.digest('hex') !== hash) throw new Error('The downloaded installer failed checksum verification. Download refused.');
        await handle.sync(); await handle.close(); handle = null;
        this.ready = { path: target, hash, size: total };
        return this.change({ status: 'ready', transferred: total, percent: 100 });
      } catch (error) { await handle?.close(); await fs.promises.rm(dir, { recursive: true, force: true }); this.downloadDir = null; throw error; }
    });
  }
  async cancel() { if (this.controller) { const finished = this.finished; this.cancelled = true; this.controller.abort(); await finished; } return this.state(); }
  async install() {
    if (this.controller) throw new Error('Wait for the update operation to finish.');
    if (!this.ready) throw new Error('Download and verify an update first.');
    return this.operation(async () => {
      const file = this.ready;
      await this.beforeInstall();
      const stat = await fs.promises.lstat(file.path);
      if (!stat.isFile() || stat.size !== file.size || await hashFile(file.path) !== file.hash) { this.ready = null; throw new Error('The downloaded installer has changed. Check and download again.'); }
      if (this.appImage) this.shell.showItemInFolder(file.path);
      else if (await this.shell.openPath(file.path)) throw new Error('The downloaded installer could not open. Use the release downloads to install it.');
      // The OS installer remains in charge. Never quit the editor or interrupt work automatically.
      return this.change({ installerOpened: true, error: '' });
    });
  }
  openReleases() { return this.shell.openExternal(this.data.releaseUrl); }
  dispose() { clearTimeout(this.startTimer); clearInterval(this.interval); this.cancel(); }
}

module.exports = { AppUpdates, version, compareVersions, installerName, releaseFor, checksumFor };
