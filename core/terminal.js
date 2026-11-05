'use strict';
// Integrated terminals backed by real pseudo-terminals (node-pty, the same layer VS Code uses).
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');
const ssh = require('./ssh');
const { terminalOutput } = require('./terminal-output');

let pty = null;
function loadPty() {
  if (pty) return pty;
  try { pty = require('@lydell/node-pty'); } catch { pty = require('node-pty'); }
  return pty;
}
const defaultShell = () => (process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash'));

class TerminalManager extends EventEmitter {
  constructor() { super(); this.terms = new Map(); this.generation = 0; }

  async createPrepared(options, environment) {
    const generation = this.generation; const env = await environment();
    if (generation !== this.generation) throw new Error('Terminal creation cancelled because its view closed.');
    return this.create({ ...options, env });
  }

  // remote: { target, port?, identityFile?, path? } opens the terminal on that SSH host, in cwd
  // (a path on the host, default the remote project folder) using the user's login shell there.
  create({ cwd, project, cols = 100, rows = 30, shell = defaultShell(), args = [], env, remote, flowControl = false } = {}) {
    const id = crypto.randomUUID();
    let title = shell.split(/[\\/]/).pop(); let spawnCwd = cwd || os.homedir();
    if (remote) {
      const r = ssh.checkRemote(remote);
      cwd = cwd || r.path;
      shell = 'ssh';
      args = [...ssh.sshOptions(r, { batch: false }), '-tt', '--', r.target, `${cwd ? `cd ${ssh.quote(cwd)} 2>/dev/null; ` : ''}exec $SHELL -l`];
      title = `ssh ${r.target}`; spawnCwd = os.homedir();
    }
    const p = loadPty().spawn(shell, args, {
      name: 'xterm-256color', cols, rows, cwd: spawnCwd,
      env: { ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Tributary' },
    });
    const term = { id, p, cwd, project: project === undefined ? cwd || null : project, shell, title, remote: remote ? remote.target : undefined, output: null, closing: false, finished: false, exitCode: null };
    this.terms.set(id, term);
    let dataSub; let exitSub;
    const finish = () => {
      if (term.finished) return; term.finished = true;
      term.output?.dispose(); dataSub?.dispose(); exitSub?.dispose();
      term.finish = null;
      this.terms.delete(id); this.emit('exit', { id, code: term.exitCode });
    };
    term.finish = finish;
    if (flowControl) term.output = terminalOutput({ send: (packet) => this.emit('data', { id, ...packet }), pause: () => p.pause(), resume: () => p.resume(), drained: finish });
    // Legacy direct consumers have no renderer ACK protocol. Keep their
    // synchronous event contract; desktop terminals use the credit window.
    let buf = ''; let timer = null;
    const flush = () => { if (timer != null) clearTimeout(timer); timer = null; if (buf) { const data = buf; buf = ''; this.emit('data', { id, data }); } };
    dataSub = p.onData((d) => { if (term.closing) return; if (term.output) term.output.push(d); else { buf += d; if (buf.length > 65536) flush(); else if (timer == null) timer = setTimeout(flush, 8); } });
    exitSub = p.onExit(({ exitCode }) => { term.exitCode = exitCode; if (term.output && !term.closing) term.output.end(); else { flush(); finish(); } });
    return id;
  }
  get(id) { const t = this.terms.get(id); if (!t) throw new Error(`No terminal ${id}`); return t; }
  write(id, data) { this.get(id).p.write(data); }
  resize(id, cols, rows) { if (cols > 0 && rows > 0) this.get(id).p.resize(Math.floor(cols), Math.floor(rows)); }
  attach(id, owner) { return this.terms.get(id)?.output?.attach(owner) || false; }
  detach(id, owner) { return this.terms.get(id)?.output?.detach(owner) || false; }
  acknowledge(id, owner, seq) { return this.terms.get(id)?.output?.ack(owner, seq) || false; }
  detachAll() { this.generation++; for (const term of this.terms.values()) term.output?.detachAll(); }
  kill(id) {
    const t = this.terms.get(id); if (!t || t.closing) return;
    t.closing = true; t.output?.dispose();
    if (t.exitCode != null) { t.finish(); return; }
    try { t.p.resume(); } catch { /* already gone */ }
    try { t.p.kill(); } catch { /* already gone */ }
  }
  killAll() { this.generation++; for (const id of [...this.terms.keys()]) this.kill(id); }
  list() { return [...this.terms.values()].filter((term) => !term.closing).map(({ id, cwd, project, title }) => ({ id, cwd, project, title })); }
}

module.exports = { TerminalManager, defaultShell };
