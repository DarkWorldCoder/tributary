'use strict';
// Foreground CLI; the app uses the same lifecycle without another runtime.
const path = require('node:path'); const os = require('node:os');
const { createLanHost } = require('./lan-host');
const dir = path.resolve(process.env.TRIBUTARY_SERVER_DATA || path.join(os.homedir(), '.tributary-server'));
const host = createLanHost({ dir });
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await host.stop(); }
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop().catch(() => { process.exitCode = 1; }));
host.start({ address: process.env.TRIBUTARY_LAN_ADDRESS, port: Number(process.env.TRIBUTARY_SERVER_PORT || 4318) }).then((state) => {
  if (stopping) return;
  console.log(`LAN address: ${state.endpoint}`);
  console.log(`Certificate fingerprint: ${state.fingerprint}`);
  console.log(`Private owner key: ${path.join(dir, 'owner-access-key.txt')}`);
  console.log('Create a shared project and an invitation for each teammate. Discovery uses UDP 4319; the room uses TCP ' + state.port + '.');
}).catch((e) => { console.error(e.message); process.exitCode = 1; });
