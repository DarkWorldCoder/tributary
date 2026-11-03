'use strict';
// Explicit, foreground LAN host. No firewall rules, background services or system trust changes.
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { execFileSync } = require('node:child_process'); const { X509Certificate } = require('node:crypto');
const { addresses, advertise } = require('../core/collaboration/peers');
const choices = addresses(); const address = process.env.TRIBUTARY_LAN_ADDRESS || choices[0];
if (!address || !choices.includes(address)) throw new Error('Connect to a private network. Set TRIBUTARY_LAN_ADDRESS to one of this computer’s private IPv4 addresses.');
const dir = path.resolve(process.env.TRIBUTARY_SERVER_DATA || path.join(os.homedir(), '.tributary-server'));
const tlsDir = path.join(dir, 'lan-tls'); fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
const certFile = path.join(tlsDir, 'certificate.pem'); const keyFile = path.join(tlsDir, 'private-key.pem');
if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
  const temp = fs.mkdtempSync(path.join(tlsDir, 'generate-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '365', '-subj', '/CN=Tributary LAN', '-addext', `subjectAltName=IP:${address}`, '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], { stdio: 'ignore', timeout: 20000 });
    fs.chmodSync(path.join(temp, 'key.pem'), 0o600); fs.renameSync(path.join(temp, 'key.pem'), keyFile); fs.renameSync(path.join(temp, 'cert.pem'), certFile);
  } catch { throw new Error('Could not create the LAN certificate. Install OpenSSL or provide TLS certificates with npm run server.'); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
const cert = new X509Certificate(fs.readFileSync(certFile));
if (Date.parse(cert.validTo) <= Date.now()) throw new Error('LAN certificate expired. Replace the files in lan-tls and share the new fingerprint.');
const port = Number(process.env.TRIBUTARY_SERVER_PORT || 4318);
const fingerprint = cert.fingerprint256.replaceAll(':', '').toLowerCase();
Object.assign(process.env, { TRIBUTARY_SERVER_DATA: dir, TRIBUTARY_SERVER_HOST: '0.0.0.0', TRIBUTARY_PUBLIC_ORIGIN: `https://${address}:${port}`, TRIBUTARY_TLS_CERT: certFile, TRIBUTARY_TLS_KEY: keyFile });
console.log(`LAN address: https://${address}:${port}`);
console.log(`Certificate fingerprint: ${fingerprint}`);
console.log('Join with the owner key on this computer; create an invitation for each teammate. Verify the fingerprint with the owner before joining.');
console.log('Nearby discovery uses UDP 4319. The room uses TCP ' + port + '. Guest-network isolation or a firewall may block connections.');
const service = require('./start');
let stopDiscovery = () => {};
service.server.once('listening', () => { stopDiscovery = advertise({ port, fingerprint }); });
service.server.once('error', () => stopDiscovery());
for (const event of ['SIGTERM', 'SIGINT', 'exit']) process.once(event, () => stopDiscovery());
