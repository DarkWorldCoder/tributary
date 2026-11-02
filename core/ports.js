'use strict';
// Dev-server ports on an SSH host: find what the user's processes listen on, and forward chosen
// ports to this computer with `ssh -L` so the Preview tab can open them.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const net = require('net');
const { killTree } = require('./proc');
const ssh = require('./ssh');

// Parse `ss -ltnp` output. Only sockets that name a process are kept: ss shows process details for
// the user's own processes only (unless run as root), which is what a developer wants to forward.
function parseListening(text) {
  const seen = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('LISTEN')) continue;
    const proc = /users:\(\("((?:[^"\\]|\\.)*)",pid=(\d+)/.exec(line);
    if (!proc) continue;
    const local = line.trim().split(/\s+/)[3] || '';
    const at = local.lastIndexOf(':');
    const port = Number(local.slice(at + 1));
    if (!port || seen.has(port)) continue;
    const address = local.slice(0, at).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    seen.set(port, { port, address, process: proc[1], pid: Number(proc[2]) });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

// Listening ports on the host, each with its process's command line so the user can tell them apart.
async function listPorts(host) {
  const r = await host.exec('sh', ['-c', 'ss -Hltnp 2>/dev/null || ss -ltnp'], { timeout: 15000 });
  if (r.code !== 0) throw new Error(/not found/.test(r.stderr) ? `ss is not installed on ${host.label}` : (String(r.stderr).trim() || 'Could not list ports'));
  const ports = parseListening(r.stdout);
  if (!ports.length) return ports;
  const ps = await host.exec('ps', ['-o', 'pid=,args=', '-p', [...new Set(ports.map((p) => p.pid))].join(',')], { timeout: 15000 });
  const commands = new Map(String(ps.stdout).split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => [Number(m[1]), m[2].slice(0, 300)]));
  return ports.map((p) => ({ ...p, command: commands.get(p.pid) || p.process }));
}

// Where sshd should connect on the host: wildcard listeners are reached through loopback.
function forwardHost(address) {
  if (!address || ['*', '0.0.0.0', '::'].includes(address)) return 'localhost';
  return address.includes(':') ? `[${address}]` : address;
}

// The remote port number when it is free here, otherwise any free port.
function freePort(preferred) {
  const tryPort = (port) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(null));
    s.listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  return tryPort(preferred).then((p) => p || tryPort(0));
}

// Resolves once the local end accepts connections; rejects if ssh exits first.
function whenListening(port, child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let stderr = ''; let over = false;
    child.stderr.on('data', (d) => { stderr += d; });
    const fail = (msg) => { if (!over) { over = true; reject(new Error(msg)); } };
    child.once('exit', (code) => fail(stderr.trim().split('\n').filter(Boolean).pop() || `ssh exited with code ${code}`));
    child.once('error', (e) => fail(e.code === 'ENOENT' ? 'ssh is not installed or not on PATH' : e.message));
    const end = Date.now() + timeoutMs;
    const attempt = () => {
      if (over) return;
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); if (!over) { over = true; resolve(); } });
      s.once('error', () => { s.destroy(); if (Date.now() > end) { killTree(child); fail(`Port forward to ${port} did not start`); } else setTimeout(attempt, 100); });
    };
    attempt();
  });
}

// Forward one remote port. Each forward is its own ssh process, so its lifetime is exactly the
// forward's and does not depend on the shared connection staying up.
async function forwardPort(remote, { port, address, localPort }) {
  const r = ssh.checkRemote(remote);
  const lp = localPort || await freePort(port);
  const child = spawn('ssh', [...ssh.sshOptions(r, { mux: false }), '-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-L', `${lp}:${forwardHost(address)}:${port}`, '--', r.target], {
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  await whenListening(lp, child);
  const closed = new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  return { target: r.target, remotePort: port, localPort: lp, url: `http://localhost:${lp}`, child, closed, close: () => { killTree(child); return closed; } };
}

// Active forwards, one per target and remote port. Emits 'change' when one opens or ends.
class PortForwards extends EventEmitter {
  constructor() { super(); this.active = new Map(); } // key -> { pending, forward }
  forward(remote, portOrInfo) {
    const info = typeof portOrInfo === 'number' ? { port: portOrInfo } : portOrInfo;
    const key = `${ssh.checkRemote(remote).target}\0${info.port}`;
    if (!this.active.has(key)) {
      const entry = { pending: null, forward: null };
      entry.pending = forwardPort(remote, info).then((f) => {
        entry.forward = f;
        f.closed.then(() => { if (this.active.get(key) === entry) { this.active.delete(key); this.emit('change'); } });
        this.emit('change');
        return f;
      }, (e) => { if (this.active.get(key) === entry) this.active.delete(key); throw e; });
      this.active.set(key, entry);
    }
    return this.active.get(key).pending;
  }
  list() {
    return [...this.active.values()].filter((e) => e.forward)
      .map(({ forward: { target, remotePort, localPort, url } }) => ({ target, remotePort, localPort, url }));
  }
  async close(localPort) {
    for (const [key, e] of [...this.active]) {
      if (e.forward && e.forward.localPort === localPort) { this.active.delete(key); await e.forward.close(); this.emit('change'); }
    }
  }
  async closeAll() {
    const all = [...this.active.values()]; this.active.clear();
    await Promise.all(all.map((e) => e.pending.then((f) => f.close(), () => {})));
  }
}

module.exports = { listPorts, parseListening, forwardPort, PortForwards };
