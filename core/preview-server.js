'use strict';
// One explicitly launched dev server per project. Uses the existing process layer;
// no daemon, dependency installation, or command supplied by the preview page.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { start, killTree } = require('./proc');
const { which, pathDirs } = require('./agents');
const { projectPath } = require('./files');

function previewUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function previewCommand(root) {
  let pkg; try { const file = await projectPath(root, 'package.json'); if (fs.statSync(file).size > 1024 * 1024) return null; pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const script = ['dev', 'start'].find((name) => typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].trim());
  if (!script) return null;
  const manager = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : ['bun.lock', 'bun.lockb'].some((file) => fs.existsSync(path.join(root, file))) ? 'bun' : 'npm';
  let bin = which(manager, process.env); let args = ['run', script];
  if (!bin) throw new Error(`${manager} is not installed.`);
  if (/\.(cmd|bat)$/i.test(bin)) {
    const entries = { npm: 'npm/bin/npm-cli.js', pnpm: 'pnpm/bin/pnpm.cjs', yarn: 'yarn/bin/yarn.js' };
    const entry = entries[manager] && path.join(path.dirname(bin), 'node_modules', entries[manager]);
    if (!entry || !fs.existsSync(entry)) throw new Error(`Open a terminal to run ${manager}.`);
    bin = process.execPath; args = [entry, ...args];
  }
  return { bin, args, command: `${manager} run ${script}` };
}

class PreviewServers extends EventEmitter {
  constructor({ discover = previewCommand } = {}) { super(); this.jobs = new Map(); this.pending = new Set(); this.discover = discover; }
  state(root) { const job = this.jobs.get(root); return { project: root, status: job?.status || 'idle', command: job?.command || '', url: job?.url || '', output: job?.output || '', error: job?.error || '', code: job?.code ?? null }; }
  changed(root) { this.emit('state', this.state(root)); }
  async launch(root, env = {}) {
    if (this.pending.has(root)) throw new Error('The preview server is already starting.');
    if (this.jobs.get(root)?.child) return this.state(root);
    this.pending.add(root);
    try {
      const command = await this.discover(root); if (!command) throw new Error('No dev or start script found. Run your app in the terminal.');
      const job = { ...command, child: null, status: 'starting', url: '', output: '', error: '', code: null, timer: null }; this.jobs.set(root, job);
      const child = start(command.bin, command.args, { cwd: root, env: { ...process.env, PATH: pathDirs().join(path.delimiter), ...env, NO_COLOR: '1', FORCE_COLOR: '0', ELECTRON_RUN_AS_NODE: '1', BROWSER: 'none' } });
      job.child = child;
      const append = (chunk) => {
        const text = chunk.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); job.output = (job.output + text).slice(-32768);
        const urls = job.output.match(/https?:\/\/[^\s<>"']+/g) || [];
        const found = urls.map(previewUrl).find(Boolean); if (found) job.url = found;
        if (!job.timer) job.timer = setTimeout(() => { job.timer = null; this.changed(root); }, 100);
      };
      child.stdout.on('data', append); child.stderr.on('data', append);
      child.once('spawn', () => { if (job.status === 'starting') { job.status = 'running'; this.changed(root); } });
      child.once('error', (error) => { job.error = error.code === 'ENOENT' ? 'The start tool is unavailable.' : error.message; job.status = 'failed'; job.child = null; this.changed(root); });
      child.once('close', (code) => { clearTimeout(job.timer); job.child = null; job.code = code; if (job.status !== 'failed') job.status = code && job.status !== 'stopping' ? 'failed' : 'stopped'; if (job.status === 'failed' && !job.error) job.error = `The app exited with code ${code}.`; this.changed(root); });
      this.changed(root); return this.state(root);
    } finally { this.pending.delete(root); }
  }
  async stop(root) {
    const job = this.jobs.get(root); if (!job?.child) return this.state(root);
    const child = job.child; job.status = 'stopping'; this.changed(root);
    await new Promise((resolve) => { child.once('close', resolve); killTree(child); });
    return this.state(root);
  }
  async restart(root, env) { await this.stop(root); return this.launch(root, env); }
  stopAll() { return Promise.all([...this.jobs.keys()].map((root) => this.stop(root))); }
}
module.exports = { PreviewServers, previewUrl, previewCommand };
