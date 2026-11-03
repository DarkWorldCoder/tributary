'use strict';
const dgram = require('node:dgram');
const os = require('node:os');
const GROUP = '239.255.43.18'; const PORT = 4319;
const privateAddress = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip);
const addresses = () => Object.values(os.networkInterfaces()).flat().filter((entry) => entry.family === 'IPv4' && !entry.internal && privateAddress(entry.address)).map((entry) => entry.address);
function decodePeer(buffer, address) {
  if (buffer.length > 1024 || !privateAddress(address)) return null;
  try {
    const value = JSON.parse(buffer.toString());
    if (value.type !== 'tributary-room-v1' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.name !== 'string') return null;
    return { endpoint: `https://${address}:${value.port}`, name: value.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80), fingerprint: value.fingerprint };
  } catch { return null; }
}
function advertise({ port, fingerprint, name = os.hostname() }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); let timer;
  const packet = Buffer.from(JSON.stringify({ type: 'tributary-room-v1', port, fingerprint, name: name.slice(0, 80) }));
  const send = () => socket.send(packet, PORT, GROUP);
  socket.on('error', () => {});
  socket.on('message', (buffer, remote) => { if (buffer.toString() === 'tributary-discover-v1' && privateAddress(remote.address)) socket.send(packet, remote.port, remote.address); });
  socket.bind(PORT, '0.0.0.0', () => { try { socket.addMembership(GROUP); socket.setMulticastTTL(1); send(); timer = setInterval(send, 5000); timer.unref(); } catch {} });
  return () => { clearInterval(timer); try { socket.close(); } catch {} };
}
function discover({ duration = 2200 } = {}) {
  return new Promise((resolve, reject) => {
    const found = new Map(); const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); let timer;
    const finish = (error) => { clearTimeout(timer); try { socket.close(); } catch {} if (error) reject(new Error('Nearby discovery unavailable. Enter the owner’s address instead.')); else resolve([...found.values()]); };
    socket.on('error', finish);
    socket.on('message', (buffer, remote) => { const peer = decodePeer(buffer, remote.address); if (peer && found.size < 100) found.set(peer.endpoint, peer); });
    socket.bind(0, '0.0.0.0', () => { socket.setMulticastTTL(1); socket.send(Buffer.from('tributary-discover-v1'), PORT, GROUP); timer = setTimeout(() => finish(), Math.min(5000, Math.max(100, duration))); });
  });
}
module.exports = { addresses, advertise, discover, decodePeer };
