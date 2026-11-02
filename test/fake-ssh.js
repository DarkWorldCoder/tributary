#!/usr/bin/env node
// Stand-in for the OpenSSH client, so the remote-host tests stay offline. It runs the "remote"
// command on this machine the way sshd would: through `sh -c "<command string>"`, in a fresh
// environment (FAKE_SSH_HOME as HOME, none of the caller's variables), in its own session.
// Supports -O control commands, -N with -L port forwards (a real TCP proxy) and -t for terminals.
// Every invocation is appended to FAKE_SSH_LOG as one JSON line.
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const WITH_VALUE = new Set('BbcDEeFIiJLlmOoPpQRSWw'.split(''));
const argv = process.argv.slice(2);
const opts = { o: [], L: [], O: null, N: false, t: 0, p: null };
let i = 0;
for (; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') { i++; break; }
  if (!a.startsWith('-') || a === '-') break;
  for (let j = 1; j < a.length; j++) {
    const c = a[j];
    if (WITH_VALUE.has(c)) {
      const v = a.slice(j + 1) || argv[++i];
      if (c === 'o') opts.o.push(v); else if (c === 'L') opts.L.push(v); else if (c === 'O') opts.O = v; else if (c === 'p') opts.p = v;
      break;
    }
    if (c === 't') opts.t++; else if (c === 'N') opts.N = true;
  }
}
const dest = argv[i];
const command = argv.slice(i + 1).join(' ');
if (process.env.FAKE_SSH_LOG) fs.appendFileSync(process.env.FAKE_SSH_LOG, `${JSON.stringify({ argv, dest, command, ...opts })}\n`);

const fail = (msg) => { process.stderr.write(`${msg}\n`); process.exit(255); };
if (!dest) fail('usage: ssh destination [command]');
if (/unreachable/.test(dest)) fail(`ssh: Could not resolve hostname ${dest.split('@').pop()}: Name or service not known`);

if (opts.O) {
  if (opts.O === 'check') process.stderr.write('Master running (pid=1)\n');
  process.exit(0);
}

if (opts.N) {
  // -L [bind:]port:host:hostport, host may be [v6]
  for (const spec of opts.L) {
    const m = /^(?:([^:[\]]+|\[[^\]]+\]):)?(\d+):(\[[^\]]+\]|[^:]+):(\d+)$/.exec(spec);
    if (!m) fail(`Bad local forwarding specification '${spec}'`);
    const host = m[3].replace(/^\[|\]$/g, ''); const port = Number(m[4]);
    const server = net.createServer((sock) => {
      const up = net.connect({ host, port });
      sock.pipe(up).pipe(sock);
      up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
    });
    server.on('error', (e) => fail(`bind [${m[1] || '127.0.0.1'}]:${m[2]}: ${e.code === 'EADDRINUSE' ? 'Address already in use' : e.message}\nError: Could not request local forwarding.`));
    server.listen(Number(m[2]), (m[1] || '127.0.0.1').replace(/^\[|\]$/g, ''));
  }
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1 << 30);
  return;
}

const env = {
  HOME: process.env.FAKE_SSH_HOME || process.env.HOME, PATH: process.env.PATH, USER: process.env.USER || 'dev',
  LOGNAME: process.env.USER || 'dev', SHELL: '/bin/sh', LANG: 'C.UTF-8', SSH_CONNECTION: '127.0.0.1 50000 127.0.0.1 22',
};
const shellCommand = command || 'exec /bin/sh -l';
if (opts.t) {
  const child = spawn('/bin/sh', ['-c', shellCommand], { stdio: 'inherit', env, cwd: env.HOME });
  child.on('close', (code) => process.exit(code == null ? 255 : code));
  return;
}
// Like sshd without a terminal: a new session, and the client's exit does not stop the command.
const child = spawn('/bin/sh', ['-c', shellCommand], { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: env.HOME, detached: true });
child.stdin.on('error', () => {});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('close', (code) => {
  process.stdin.destroy();
  process.stdout.write('', () => process.exit(code == null ? 255 : code));
});
