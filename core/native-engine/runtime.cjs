'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { PassThrough, Transform } = require('node:stream');

function supportsRuntime(data) {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform];
  return !!arch && !!os && data?.protocol === 1 && data.runtime === 1 && data.arch === arch && data.os === os;
}

class RuntimeOwner extends EventEmitter {
  constructor(binary, executable, args, options, fallback, { spawnImpl = spawn, probeMs = 1500 } = {}) {
    super();
    Object.assign(this, { binary, executable, args, options, fallback, spawnImpl, probeMs });
    this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.exitCode = null; this.signalCode = null; this.pid = undefined; this.runtimePid = undefined;
    this.child = null; this.probe = null; this.stopSignal = null; this.finished = false; this.failed = false;
    queueMicrotask(() => this.check());
  }
  error(error) { if (!this.failed && !this.stopSignal) { this.failed = true; this.emit('error', error); } }
  finish(code, signal) {
    if (this.finished) return;
    this.finished = true; this.exitCode = code; this.signalCode = signal;
    this.stdout.end(); this.stderr.end(); this.emit('close', code, signal);
    this.child = null; this.fallback = null; this.args = null; this.options = null;
    this.drain = null; this.maybeFinish = null;
  }
  kill(signal) {
    if (this.finished) return false;
    const next = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM';
    if (this.stopSignal === 'SIGKILL' || this.stopSignal === next) return true;
    this.stopSignal = next;
    // Identity never launches a runtime. Wait for its actual close before
    // reporting cancellation or selecting the compatibility fallback.
    if (this.probe) { this.probe.kill('SIGKILL'); return true; }
    if (!this.child) return true;
    const child = this.child; this.drain?.();
    if (this.backend === 'javascript') return child.kill(next);
    if (child.stdin.destroyed || !child.stdin.writable) return false;
    try { child.stdin.write(next === 'SIGKILL' ? 'K' : 'G'); return true; } catch { return false; }
  }
  check() {
    if (this.stopSignal) { this.finish(0, null); return; }
    let child;
    try { child = this.spawnImpl(this.binary, ['--identity'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { this.launch(false); return; }
    this.probe = child; let bytes = 0, invalid = false; const chunks = [];
    const timer = setTimeout(() => { invalid = true; child.kill('SIGKILL'); }, this.probeMs);
    child.on('error', () => { invalid = true; });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024) { invalid = true; child.kill('SIGKILL'); }
      else if (!invalid) chunks.push(chunk);
    });
    child.once('close', code => {
      clearTimeout(timer); this.probe = null;
      if (this.stopSignal) { this.finish(0, null); return; }
      let supported = false;
      if (!invalid && code === 0) try { supported = supportsRuntime(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch {}
      this.launch(supported);
    });
  }
  launch(native) {
    if (this.stopSignal) { this.finish(0, null); return; }
    this.backend = native ? 'native' : 'javascript'; let child;
    try {
      child = native ? this.spawnImpl(this.binary, ['guard-runtime', ...(this.options.cleanupDirectory === true ? ['--cleanup-owned-cwd'] : []), '--', this.executable, ...this.args], {
        cwd: this.options.cwd, windowsHide: true, shell: false,
        // The Windows owner must survive long enough to observe pipe closure,
        // reap the model and remove its key when the creating process crashes.
        // Its private pipes remain connected; this is not a detached service.
        detached: process.platform === 'win32',
        env: { ...process.env, ...this.options.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      }) : this.fallback();
    } catch (error) { this.error(error); this.finish(1, null); return; }
    this.child = child; this.pid = child.pid;
    let closed = null, outputs = 0;
    this.maybeFinish = () => {
      if (!closed || !this.stopSignal && outputs !== 2) return;
      if (!native) this.runtimePid = child.runtimePid;
      const [code, signal] = closed;
      this.finish(!this.stopSignal && native && !this.runtimePid && code === 0 ? 1 : code, signal);
    };
    const outputEnded = () => { outputs++; this.maybeFinish?.(); };
    child.once('error', error => this.error(error));
    child.once('close', (code, signal) => {
      closed = [code, signal]; this.maybeFinish?.();
    });
    child.stderr.once('end', outputEnded);
    child.stderr.pipe(this.stderr, { end: false });
    if (!native) {
      child.on('message', message => { if (message?.type === 'runtime-started') this.runtimePid = child.runtimePid; });
      this.drain = () => { child.stdout.unpipe(this.stdout); child.stderr.unpipe(this.stderr); child.stdout.resume(); child.stderr.resume(); this.maybeFinish?.(); };
      child.stdout.once('end', outputEnded);
      child.stdout.pipe(this.stdout, { end: false });
      return;
    }
    // Once guard-runtime is launched, never retry into a second owner. Even a
    // missing/malformed handshake must kill and await the actual helper close.
    child.stdin.on('error', () => {});
    let header = Buffer.alloc(0), started = false;
    const owner = this;
    const parser = new Transform({
      transform(chunk, _encoding, callback) {
        if (started) { callback(null, chunk); return; }
        const newline = chunk.indexOf(10), length = newline === -1 ? chunk.length : newline;
        if (header.length + length > 128) { callback(Error('Invalid local runtime helper metadata.')); return; }
        header = Buffer.concat([header, chunk.subarray(0, length)]);
        if (newline === -1) { callback(); return; }
        try {
          const data = JSON.parse(header.toString('ascii'));
          if (!Number.isSafeInteger(data.runtimePid) || data.runtimePid < 1) throw Error('Invalid local runtime PID.');
          owner.runtimePid = data.runtimePid; started = true; header = null;
          callback(null, chunk.subarray(newline + 1));
        } catch { callback(Error('Invalid local runtime helper metadata.')); }
      },
      flush(callback) { callback(!started && header.length && !owner.stopSignal ? Error('Incomplete local runtime helper metadata.') : null); },
    });
    parser.once('end', outputEnded);
    parser.on('error', error => {
      this.error(error); this.kill('SIGKILL');
      child.stdout.resume(); child.stderr.resume();
    });
    this.drain = () => {
      child.stdout.unpipe(parser); parser.unpipe(this.stdout); parser.destroy();
      child.stderr.unpipe(this.stderr); child.stdout.resume(); child.stderr.resume();
      this.maybeFinish?.();
    };
    child.stdout.pipe(parser).pipe(this.stdout, { end: false });
  }
}

function spawnRuntime(binary, executable, args, options, fallback, internals) {
  return new RuntimeOwner(binary, executable, args, options, fallback, internals);
}
module.exports = { spawnRuntime };
