'use strict';
// Integrated terminals backed by real pseudo-terminals (node-pty, the same layer VS Code uses).
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');

let pty = null;
function loadPty() {
  if (pty) return pty;
  try { pty = require('@lydell/node-pty'); } catch { pty = require('node-pty'); }
  return pty;
}
const defaultShell = () => (process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash'));

class TerminalManager extends EventEmitter {
  constructor() { super(); this.terms = new Map(); }

  create({ cwd = os.homedir(), cols = 100, rows = 30, shell = defaultShell(), args = [], env } = {}) {
    const id = crypto.randomUUID();
    const p = loadPty().spawn(shell, args, {
      name: 'xterm-256color', cols, rows, cwd,
      env: { ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Tributary' },
    });
    // Coalesce bursts of output into ~8 ms frames so heavy output does not flood the UI.
    let buf = ''; let timer = null;
    const flush = () => { timer = null; if (buf) { const data = buf; buf = ''; this.emit('data', { id, data }); } };
    p.onData((d) => { buf += d; if (buf.length > 65536) flush(); else if (!timer) timer = setTimeout(flush, 8); });
    p.onExit(({ exitCode }) => { if (timer) clearTimeout(timer); flush(); this.terms.delete(id); this.emit('exit', { id, code: exitCode }); });
    this.terms.set(id, { id, p, cwd, shell, title: shell.split(/[\\/]/).pop() });
    return id;
  }
  get(id) { const t = this.terms.get(id); if (!t) throw new Error(`No terminal ${id}`); return t; }
  write(id, data) { this.get(id).p.write(data); }
  resize(id, cols, rows) { if (cols > 0 && rows > 0) this.get(id).p.resize(Math.floor(cols), Math.floor(rows)); }
  kill(id) { const t = this.terms.get(id); if (t) { try { t.p.kill(); } catch { /* already gone */ } } }
  killAll() { for (const id of [...this.terms.keys()]) this.kill(id); }
  list() { return [...this.terms.values()].map(({ id, cwd, title }) => ({ id, cwd, title })); }
}

module.exports = { TerminalManager, defaultShell };
