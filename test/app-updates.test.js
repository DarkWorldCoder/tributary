'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { AppUpdates, compareVersions, installerName, releaseFor, checksumFor } = require('../desktop/updates');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('a real installer would have these bytes');
const name = 'Tributary-0.2.0-win-x64.exe';
const asset = { name, id: 10, size: bytes.length, digest: `sha256:${hash(bytes)}` };
const sums = { name: 'SHA256SUMS.txt', id: 11, size: 100 };
const release = { tag_name: 'v0.2.0', draft: false, prerelease: true, body: 'New editor features', assets: [asset, sums] };
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-updates-test-'));
  const secrets = new Map(); const requests = []; const opened = [];
  const updater = new AppUpdates({
    app: { isPackaged: true, getVersion: () => '0.1.1', getPath: () => dir },
    platform: 'win32', arch: 'x64', appImage: false,
    secrets: { kind: 'encrypted', get: async (key) => secrets.get(key), set: async (key, value) => secrets.set(key, value), delete: async (key) => secrets.delete(key) },
    shell: { openPath: async (file) => { opened.push(file); return ''; }, showItemInFolder: (file) => opened.push(file), openExternal: (url) => opened.push(url) },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.includes('/releases?')) return Response.json([release]);
      if (url.endsWith('/11')) return new Response(`${hash(bytes)}  ${name}\n`);
      if (url.endsWith('/10')) return new Response(bytes);
      throw new Error('Unexpected request');
    }, ...options,
  });
  t.after(() => { updater.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { updater, dir, secrets, requests, opened };
}

test('selects exact native installers and compares stable and prerelease versions without downgrades', () => {
  for (const [platform, arch, appImage, expected] of [
    ['win32', 'x64', false, 'win-x64.exe'], ['win32', 'arm64', false, 'win-arm64.exe'],
    ['darwin', 'x64', false, 'mac-x64.dmg'], ['darwin', 'arm64', false, 'mac-arm64.dmg'],
    ['linux', 'x64', false, 'linux-amd64.deb'], ['linux', 'arm64', false, 'linux-arm64.deb'],
    ['linux', 'x64', true, 'linux-x86_64.AppImage'], ['linux', 'arm64', true, 'linux-arm64.AppImage'],
  ]) assert.equal(installerName('0.2.0', platform, arch, appImage), `Tributary-0.2.0-${expected}`);
  assert.equal(installerName('0.2.0', 'win32', 'ia32'), null);
  assert.equal(installerName('../evil', 'win32', 'x64'), null);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0-preview.2'), 1);
  assert.equal(compareVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.2'), 0);
  assert.equal(releaseFor([release], '0.2.0', 'win32', 'x64', false), null);
  assert.equal(releaseFor([{ ...release, draft: true }], '0.1.1', 'win32', 'x64', false), null);
  assert.equal(releaseFor([release], '0.1.1', 'win32', 'x64', false).asset.id, 10);
  assert.throws(() => releaseFor([release], '0.1.1', 'darwin', 'x64', false), /complete installer/);
});

test('initialization never contacts GitHub or installs without user action', async (t) => {
  const { updater, requests, opened } = fixture(t);
  assert.equal((await updater.init()).autoCheck, false);
  assert.equal(requests.length, 0); assert.equal(opened.length, 0);
  await updater.check(); assert.equal(requests.length, 1); assert.equal(updater.state().status, 'available');
  assert.equal(opened.length, 0); assert.equal(fs.readdirSync(updater.app.getPath('temp')).length, 0);
});

test('private access tokens remain in the secret store, never in settings, events or state', async (t) => {
  const { updater, dir, secrets, requests } = fixture(t); const token = 'github_pat_private_test_value_123456789'; const events = [];
  updater.on('state', (state) => events.push(state));
  await updater.configure({ token, autoCheck: true });
  assert.equal(secrets.size, 1); assert.ok(!fs.readFileSync(path.join(dir, 'updates.json'), 'utf8').includes(token));
  assert.ok(!JSON.stringify(events).includes(token));
  await updater.check(); assert.equal(requests[0].init.headers.Authorization, `Bearer ${token}`);
  await updater.configure({ clearToken: true, autoCheck: false });
  assert.equal(secrets.size, 0); assert.equal(updater.state().hasToken, false);
});

test('asset redirects strip private credentials and reject untrusted hosts and HTTP', async (t) => {
  const requests = [];
  const { updater } = fixture(t, { fetch: async (url, init) => { requests.push({ url, init }); return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/download' } }) : new Response('asset'); } });
  await updater.request('https://api.github.com/repos/DarkWorldCoder/tributary/releases/assets/10', 'secret', new AbortController().signal);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret'); assert.equal(requests[1].init.headers.Authorization, undefined);
  for (const url of ['https://evil.example/asset', 'http://github.com/asset', 'https://github.com.evil.example/asset', 'https://github.com:444/asset', 'https://user:pass@github.com/asset']) await assert.rejects(() => updater.request(url, 'secret'), /untrusted/);
});

test('downloads stream to a private temporary file and verifies bytes before opening the OS installer', async (t) => {
  const { updater, opened } = fixture(t);
  await updater.check(); await updater.download();
  assert.equal(updater.state().status, 'ready'); assert.equal(updater.state().percent, 100); assert.equal(opened.length, 0);
  assert.deepEqual(fs.readFileSync(updater.ready.path), bytes);
  if (process.platform !== 'win32') assert.equal(fs.statSync(updater.ready.path).mode & 0o777, 0o600);
  await updater.install(); assert.equal(opened.length, 1); assert.equal(updater.state().installerOpened, true);
});

test('corrupt or partial downloads are removed and never become installable', async (t) => {
  const { updater, dir, opened } = fixture(t);
  const original = updater.fetch;
  updater.fetch = (url, init) => url.endsWith('/10') ? Promise.resolve(new Response('corrupt installer bytes')) : original(url, init);
  await updater.check(); await updater.download();
  assert.equal(updater.state().status, 'error'); assert.match(updater.state().error, /checksum verification/);
  assert.equal(updater.ready, undefined); assert.deepEqual(fs.readdirSync(dir), []); assert.equal(opened.length, 0);
});

test('refuses duplicate manifest entries and inconsistent GitHub asset digests', async (t) => {
  assert.throws(() => checksumFor(`${hash(bytes)}  ${name}\n${hash(bytes)}  ${name}`, name), /ambiguous/);
  assert.throws(() => checksumFor(`${hash(bytes)}  wrong.exe`, name), /missing/);
  const { updater } = fixture(t);
  await updater.check(); updater.release.asset = { ...asset, digest: `sha256:${'0'.repeat(64)}` };
  await updater.download(); assert.equal(updater.state().status, 'error'); assert.match(updater.state().error, /checksums disagree/);
});

test('rechecks installer bytes at install time to detect changes after verification', async (t) => {
  const { updater, opened } = fixture(t); await updater.check(); await updater.download();
  fs.writeFileSync(updater.ready.path, Buffer.alloc(bytes.length, 33));
  await updater.install(); assert.equal(opened.length, 0); assert.equal(updater.ready, null); assert.equal(updater.state().status, 'error');
});

test('running-work guard blocks install and permits a retry after work finishes', async (t) => {
  let busy = true; const { updater, opened } = fixture(t, { beforeInstall: () => { if (busy) throw new Error('Stop agents before opening the installer.'); } });
  await updater.check(); await updater.download(); await updater.install();
  assert.equal(opened.length, 0); assert.equal(updater.state().status, 'ready'); assert.match(updater.state().error, /Stop agents/);
  busy = false; await updater.install(); assert.equal(opened.length, 1);
});

test('cancellation aborts an in-flight download, removes partial data and allows retry', async (t) => {
  const { updater, dir } = fixture(t); const original = updater.fetch;
  updater.fetch = (url, init) => url.endsWith('/10') ? new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })) : original(url, init);
  await updater.check(); const task = updater.download();
  while (!updater.downloadDir) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => updater.check(), /already running/);
  updater.cancel(); await task; assert.equal(updater.state().status, 'available'); assert.equal(updater.state().error, ''); assert.deepEqual(fs.readdirSync(dir), []);
  updater.fetch = original; await updater.download(); assert.equal(updater.state().status, 'ready');
});

test('authentication and transport failures have useful redacted errors', async (t) => {
  const { updater } = fixture(t, { fetch: async () => new Response(null, { status: 404 }) });
  await updater.check(); assert.equal(updater.state().status, 'error'); assert.match(updater.state().error, /Contents: read/);
  updater.fetch = async () => { throw new Error('fetch failed Authorization: Bearer this_is_a_secret'); };
  await updater.check(); assert.ok(!JSON.stringify(updater.state()).includes('this_is_a_secret'));
});

test('Chromium update transport exposes one redirect and strips API credentials before the next request', async t => {
  const { EventEmitter } = require('node:events'); const { PassThrough } = require('node:stream');
  const { createUpdateFetch } = require('../desktop/update-fetch'); const calls = [];
  const net = { request(options) {
    const request = new EventEmitter(); calls.push({ options, request });
    request.abort = () => { request.aborted = true; };
    request.end = () => queueMicrotask(() => {
      if (calls.length === 1) request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/installer', {});
      else { const response = new PassThrough(); Object.assign(response, { statusCode: 200, headers: { 'content-type': ['application/octet-stream'] }, complete: true }); request.emit('response', response); response.end(bytes); }
    });
    return request;
  } };
  const { updater } = fixture(t, { fetch: createUpdateFetch(net) });
  const response = await updater.request('https://api.github.com/repos/DarkWorldCoder/tributary/releases/assets/10', 'private-token', new AbortController().signal, 'application/octet-stream');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(calls.length, 2); assert.equal(calls[0].request.aborted, true);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.redirect, 'manual'); assert.equal(calls[1].options.credentials, 'omit');
});

test('Chromium update transport cancels both a pending request and a streamed response', async () => {
  const { EventEmitter } = require('node:events'); const { PassThrough } = require('node:stream');
  const { createUpdateFetch } = require('../desktop/update-fetch');
  for (const streaming of [false, true]) {
    let request, incoming;
    const fetch = createUpdateFetch({ request() {
      request = new EventEmitter(); request.abort = () => { request.aborted = true; };
      request.end = () => { if (streaming) queueMicrotask(() => { incoming = new PassThrough(); Object.assign(incoming, { statusCode: 200, headers: {} }); request.emit('response', incoming); incoming.write('partial'); }); };
      return request;
    } });
    const controller = new AbortController(); const result = fetch('https://github.com/installer', { signal: controller.signal });
    if (streaming) {
      const response = await result; const reading = response.arrayBuffer(); controller.abort();
      await assert.rejects(reading, { name: 'AbortError' }); assert.equal(incoming.destroyed, true);
    } else { controller.abort(); await assert.rejects(result, { name: 'AbortError' }); }
    assert.equal(request.aborted, true);
  }
});

test('Chromium installer buffering is bounded in bytes while the disk consumer is paused', async () => {
  const { EventEmitter } = require('node:events'); const { Readable } = require('node:stream');
  const { createUpdateFetch } = require('../desktop/update-fetch'); let produced = 0, request;
  const total = 4 * 1024 * 1024;
  const fetch = createUpdateFetch({ request() {
    request = new EventEmitter(); request.abort = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new Readable({ highWaterMark: 16 * 1024, read() {
        if (produced >= total) { this.push(null); return; }
        produced += 1024; this.push(Buffer.alloc(1024));
      } });
      Object.assign(response, { statusCode: 200, headers: {}, complete: true }); request.emit('response', response);
    }); return request;
  } });
  const response = await fetch('https://github.com/installer');
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.ok(produced <= 96 * 1024, `Paused consumer buffered ${produced} bytes`);
  assert.equal((await response.arrayBuffer()).byteLength, total);
});
