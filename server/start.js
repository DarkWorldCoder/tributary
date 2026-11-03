'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createService } = require('./service');
const dir = path.resolve(process.env.TRIBUTARY_SERVER_DATA || path.join(os.homedir(), '.tributary-server'));
const host = process.env.TRIBUTARY_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.TRIBUTARY_SERVER_PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.TRIBUTARY_PUBLIC_ORIGIN) throw new Error('Set TRIBUTARY_PUBLIC_ORIGIN to your HTTPS service address before sharing this service.');
if (process.env.TRIBUTARY_PUBLIC_ORIGIN && new URL(process.env.TRIBUTARY_PUBLIC_ORIGIN).protocol !== 'https:') throw new Error('A shared server requires an HTTPS public origin.');
const certFile = process.env.TRIBUTARY_TLS_CERT; const keyFile = process.env.TRIBUTARY_TLS_KEY;
if (!!certFile !== !!keyFile) throw new Error('Set both TRIBUTARY_TLS_CERT and TRIBUTARY_TLS_KEY.');
const tls = certFile ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) } : undefined;
const service = createService({ dbPath: path.join(dir, 'projects.sqlite'), ownerName: process.env.TRIBUTARY_OWNER_NAME || 'Project owner', publicOrigin: process.env.TRIBUTARY_PUBLIC_ORIGIN, tls });
if (service.bootstrapToken) {
  fs.writeFileSync(path.join(dir, 'owner-access-key.txt'), service.bootstrapToken + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Owner access key saved privately in ${path.join(dir, 'owner-access-key.txt')}`);
}
service.server.on('error', (error) => { console.error(`Project service could not listen: ${error.code || 'server error'}. Check the address and port.`); process.exitCode = 1; });
service.server.listen(port, host, () => console.log(`Tributary project room: ${process.env.TRIBUTARY_PUBLIC_ORIGIN || `${tls ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${port}`}/room`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));

module.exports = service;
