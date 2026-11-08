'use strict';
// Optional owned CPU llama.cpp process. No downloads, shell, GPU changes or
// external service unloads. The native server owns idle sleep and wake-up.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawnOwnedRuntime } = require('./local-engine-process');
const { EventEmitter } = require('node:events');
const CONTEXTS = [1024, 2048, 4096, 8192, 16384, 32768];
function engineConfig(input = {}) {
  const file = (value, label, preserveName = false) => {
    if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || value.includes('\0')) throw Error(`Choose an absolute ${label} file path.`);
    const actual = fs.realpathSync(value); if (!fs.statSync(actual).isFile()) throw Error(`Choose a ${label} file.`); return preserveName ? path.resolve(value) : actual;
  };
  const serverPath = file(input.serverPath, 'llama-server executable', true), modelPath = file(input.modelPath, 'GGUF model');
  if (process.platform !== 'win32') fs.accessSync(serverPath, fs.constants.X_OK);
  const fd = fs.openSync(modelPath, 'r'), magic = Buffer.alloc(4);
  try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (magic.toString() !== 'GGUF') throw Error('Choose a GGUF model file.');
  const context = input.context ?? 4096, idleSeconds = input.idleSeconds ?? 60, threads = input.threads ?? 2, port = input.port ?? 0;
  if (!CONTEXTS.includes(context)) throw Error('Choose a supported context size.');
  if (!Number.isInteger(idleSeconds) || idleSeconds < 1 || idleSeconds > 3600) throw Error('Idle release must be between 1 and 3,600 seconds.');
  if (![1, 2, 4].includes(threads)) throw Error('Choose 1, 2 or 4 CPU threads.');
  if (!Number.isInteger(port) || port !== 0 && (port < 1024 || port > 65535)) throw Error('Use an available local engine port.');
  return { serverPath, modelPath, context, idleSeconds, threads, port };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = (hint = 0) => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(hint, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); }); });
class LocalEngine extends EventEmitter {
  constructor({ dataDir, spawnImpl = spawnOwnedRuntime, fetchImpl = fetch, startupMs = 120000, stopMs = 3000 } = {}) {
    super(); Object.assign(this, { dataDir, spawnImpl, fetchImpl, startupMs, stopMs });
    this.status = 'stopped'; this.child = null; this.config = null; this.baseUrl = ''; this.model = ''; this.apiKey = ''; this.error = ''; this.tail = ''; this.starting = null; this.stopping = null;
    this.onExit = () => this.killNow(); process.once('exit', this.onExit);
  }
  state() { return { status: this.status, active: !!this.child, config: this.config && { ...this.config }, baseUrl: this.baseUrl, model: this.model, error: this.error }; }
  changed() { this.emit('state', this.state()); }
  async props() {
    const response = await this.fetchImpl(new URL('/props', this.baseUrl), { redirect: 'error', signal: AbortSignal.timeout(2000), headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!response.ok) throw Error('The local engine is not responding.');
    // This route is read-only and exempt from the native idle timer. The
    // response can contain a large template, so never retain or expose it.
    const body = response.body?.getReader(); if (!body) throw Error('The local engine returned no status.');
    let bytes = 0; const chunks = [];
    try { while (true) { const row = await body.read(); if (row.done) break; bytes += row.value.length; if (bytes > 2 * 1024 ** 2) throw Error('The local engine status exceeded its size limit.'); chunks.push(Buffer.from(row.value)); } }
    finally { try { await body.cancel(); } catch {} body.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof data.is_sleeping !== 'boolean') throw Error('Use a current llama.cpp server with idle sleep support.');
    return { sleeping: data.is_sleeping };
  }
  async refresh() {
    if (!this.child || !['ready', 'sleeping'].includes(this.status)) return this.state();
    const child = this.child, value = await this.props();
    if (this.child === child && ['ready', 'sleeping'].includes(this.status)) { this.status = value.sleeping ? 'sleeping' : 'ready'; this.changed(); }
    return this.state();
  }
  start(input) {
    const config = engineConfig(input);
    if (this.stopping) return Promise.reject(Error('Wait for the local engine to stop.'));
    if (this.child || this.starting) {
      if (!Object.keys(config).every(key => key === 'port' && config.port === 0 || config[key] === this.config[key])) return Promise.reject(Error('Stop the current local engine before changing its files or settings.'));
      return this.starting || this.refresh();
    }
    this.config = config; this.status = 'starting'; this.error = ''; this.tail = ''; this.abort = new AbortController(); this.changed();
    const work = this.launch(config); this.starting = work;
    void work.finally(() => { if (this.starting === work) this.starting = null; }).catch(() => {});
    return work;
  }
  async launch(config) {
    let directory;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true }); directory = fs.mkdtempSync(path.join(this.dataDir, 'local-engine-')); fs.chmodSync(directory, 0o700);
      const key = crypto.randomBytes(32).toString('hex'), keyFile = path.join(directory, 'api-key'); fs.writeFileSync(keyFile, key + '\n', { mode: 0o600 });
      const port = await freePort(config.port); this.abort.signal.throwIfAborted(); this.config = { ...config, port };
      this.apiKey = key; this.baseUrl = `http://127.0.0.1:${port}/v1`; this.model = 'tributary-' + crypto.createHash('sha256').update(config.modelPath).digest('hex').slice(0, 16);
      const args = ['--model', config.modelPath, '--alias', this.model, '--offline', '--host', '127.0.0.1', '--port', String(port), '--api-key-file', keyFile, '--no-webui', '--n-gpu-layers', '0', '--threads', String(config.threads), '--threads-batch', String(config.threads), '--ctx-size', String(config.context), '--parallel', '1', '--batch-size', '128', '--ubatch-size', '64', '--cache-ram', '0', '--sleep-idle-seconds', String(config.idleSeconds)];
      const child = this.spawnImpl(config.serverPath, args, { cwd: directory, cleanupDirectory: true, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); this.child = child;
      let spawnError;
      this.closed = new Promise(resolve => {
        child.once('error', error => { spawnError = error; });
        child.once('close', (code, signal) => {
          if (this.child === child) {
            if (this.status !== 'stopping') { this.status = 'error'; this.error = this.clean(spawnError?.message || this.tail || `Local engine exited (${code ?? signal}).`); }
            this.child = null; this.apiKey = ''; this.tail = ''; this.changed();
          }
          fs.rmSync(directory, { recursive: true, force: true }); resolve();
        });
      });
      for (const stream of [child.stdout, child.stderr]) stream?.setEncoding('utf8').on('data', chunk => { this.tail = (this.tail + chunk).slice(-8192); });
      const end = Date.now() + this.startupMs;
      while (true) {
        this.abort.signal.throwIfAborted(); if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode || this.child !== child) throw Error(this.error || 'The local engine exited during startup.');
        try {
          await this.props();
          const catalog = await require('./local-models').inspect({ service: 'llamacpp', baseUrl: this.baseUrl, apiKey: key }, { fetchImpl: this.fetchImpl, timeoutMs: 2000 });
          if (!catalog.models.some(model => model.id === this.model)) throw Error('The expected model is not ready.');
          break;
        } catch (error) { if (Date.now() >= end) throw Error('The local engine did not become ready. ' + error.message); }
        await delay(100);
      }
      this.abort.signal.throwIfAborted(); this.status = 'ready'; this.changed(); return this.state();
    } catch (error) {
      const message = this.clean(error.message || 'Could not start the local engine.');
      await this.terminate(); if (directory) fs.rmSync(directory, { recursive: true, force: true });
      if (this.status !== 'stopping' && this.status !== 'stopped') { this.status = 'error'; this.error = message; this.changed(); }
      throw Error(message);
    }
  }
  clean(value) { return String(value).split(this.apiKey || '\0').join('[redacted]').slice(-500); }
  killNow() { const child = this.child; if (child?.pid && child.exitCode === null && !child.signalCode) try { child.kill('SIGKILL'); } catch {} }
  async terminate() {
    const child = this.child; if (!child) return;
    const closed = this.closed;
    if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    let timer; const done = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), this.stopMs); })]); clearTimeout(timer);
    if (!done) { child.kill('SIGKILL'); await closed; }
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.status = 'stopping'; this.abort?.abort(new Error('Local engine startup stopped.')); this.changed();
    const starting = this.starting;
    const work = (async () => { await this.terminate(); try { await starting; } catch {} this.status = 'stopped'; this.error = ''; this.baseUrl = ''; this.model = ''; this.apiKey = ''; this.tail = ''; this.abort = null; this.changed(); return this.state(); })();
    this.stopping = work; void work.finally(() => { if (this.stopping === work) this.stopping = null; }).catch(() => {}); return work;
  }
  async dispose() { try { await this.stop(); } finally { process.removeListener('exit', this.onExit); } }
}
module.exports = { LocalEngine, engineConfig, CONTEXTS };
