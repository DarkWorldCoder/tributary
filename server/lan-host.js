'use strict';
// Shared lifecycle for the desktop app and foreground CLI. Nothing starts on import.
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { X509Certificate, randomBytes } = require('node:crypto');
const peers = require('../core/collaboration/peers');
const run = promisify(execFile);

async function certificate(dir, address) {
  const tlsDir = path.join(dir, 'lan-tls');
  await fs.mkdir(tlsDir, { recursive: true, mode: 0o700 });
  const certFile = path.join(tlsDir, 'certificate.pem');
  const keyFile = path.join(tlsDir, 'private-key.pem');
  const exists = async (file) => fs.access(file).then(() => true, () => false);
  const [hasCert, hasKey] = await Promise.all([exists(certFile), exists(keyFile)]);
  if (hasCert !== hasKey) throw new Error('The LAN certificate or private key is missing. Restore the pair in the project-room/lan-tls folder.');
  if (!hasCert) {
    const temp = await fs.mkdtemp(path.join(tlsDir, 'generate-'));
    try {
      await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '365', '-subj', '/CN=Tributary LAN', '-addext', `subjectAltName=IP:${address}`, '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], { timeout: 20000, windowsHide: true });
      await fs.chmod(path.join(temp, 'key.pem'), 0o600);
      await fs.rename(path.join(temp, 'key.pem'), keyFile);
      await fs.rename(path.join(temp, 'cert.pem'), certFile);
    } catch {
      throw new Error('Could not create the LAN certificate. Install OpenSSL and try again.');
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }
  const [cert, key] = await Promise.all([fs.readFile(certFile), fs.readFile(keyFile)]);
  const parsed = new X509Certificate(cert);
  if (Date.parse(parsed.validTo) <= Date.now()) throw new Error('LAN certificate expired. Replace the pair in lan-tls and share the new fingerprint.');
  return { cert, key, fingerprint: parsed.fingerprint256.replaceAll(':', '').toLowerCase() };
}

function createLanHost({ dir, addresses = peers.addresses, advertise = peers.advertise } = {}) {
  if (!dir) throw new Error('A private room data directory is required.');
  let hosted = null;
  let queue = Promise.resolve();
  // Serialize starts/stops, including a quit while certificate creation is pending.
  const enqueue = (work) => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const state = () => ({ running: !!hosted, addresses: [...new Set(addresses())], endpoint: hosted?.endpoint || '', fingerprint: hosted?.fingerprint || '', address: hosted?.address || '', port: hosted?.port || 4318 });
  return {
    state,
    start({ address, port = 4318 } = {}) {
      return enqueue(async () => {
        if (hosted) return state();
        const choices = state().addresses;
        address = address || choices[0];
        if (!address || !choices.includes(address)) throw new Error('Connect to Wi-Fi or Ethernet, then choose this computer’s private network address.');
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 to 65535.');
        const tls = await certificate(dir, address);
        const endpoint = `https://${address}:${port}`;
        const dbPath = path.join(dir, 'projects.sqlite');
        const ownerFile = path.join(dir, 'owner-access-key.txt');
        let accessKey;
        try { accessKey = (await fs.readFile(ownerFile, 'utf8')).trim(); }
        catch (e) {
          if (e.code !== 'ENOENT') throw e;
          const hasDatabase = await fs.access(dbPath).then(() => true, () => false);
          if (hasDatabase) throw new Error('The private owner key is missing. Restore owner-access-key.txt from your room backup.');
          accessKey = randomBytes(32).toString('base64url');
          // Persist the key before creating the database, including across an interrupted start.
          await fs.writeFile(ownerFile, accessKey + '\n', { mode: 0o600, flag: 'wx' });
        }
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(accessKey)) throw new Error('The private owner key is invalid. Restore owner-access-key.txt from your room backup.');
        await fs.chmod(ownerFile, 0o600);
        const { createService } = require('./service');
        const service = createService({ dbPath, bootstrapToken: accessKey, ownerName: 'Project owner', publicOrigin: endpoint, tls });
        let stopDiscovery = () => {};
        try {
          await new Promise((resolve, reject) => {
            const error = (e) => { service.server.removeListener('listening', listening); reject(e); };
            const listening = () => { service.server.removeListener('error', error); resolve(); };
            service.server.once('error', error); service.server.once('listening', listening);
            service.server.listen(port, address);
          });
          stopDiscovery = advertise({ port, fingerprint: tls.fingerprint, address });
          hosted = { service, stopDiscovery, endpoint, fingerprint: tls.fingerprint, address, port, accessKey };
          return state();
        } catch (e) {
          stopDiscovery(); await service.close();
          if (e.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Choose another port in Hosting options.`);
          if (e.code === 'EADDRNOTAVAIL') throw new Error('That network address is no longer available. Reconnect and choose another address.');
          if (e.code === 'ENOENT') throw new Error('The private owner key is missing. Restore owner-access-key.txt from your room backup.');
          throw e;
        }
      });
    },
    connectOwner(connect) {
      return enqueue(async () => {
        if (!hosted) throw new Error('Start hosting first.');
        // Credentials never leave the main process through status or IPC results.
        return connect({ endpoint: hosted.endpoint, fingerprint: hosted.fingerprint, accessKey: hosted.accessKey });
      });
    },
    stop() {
      return enqueue(async () => {
        if (hosted) {
          const current = hosted; hosted = null;
          current.stopDiscovery(); current.accessKey = '';
          await current.service.close();
        }
        return state();
      });
    },
  };
}
module.exports = { createLanHost };
