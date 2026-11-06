'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { start, killTree, lines, streamTail } = require('./proc'); const { projectPath } = require('./files'); const { editorSettings } = require('./editor-settings');
const closed = () => Error('The lint document was closed.');
class EslintTools {
  constructor({ trusted }) { this.trusted = trusted; this.owners = new Map(); this.lanes = new Map(); }
  acquire(root, rel) {
    if (typeof rel !== 'string' || rel.length > 4096 || rel.includes('\0') || path.isAbsolute(rel)) throw Error('Invalid lint document.');
    if (this.owners.size >= 128) throw Error('Too many open lint documents.');
    const owner = randomUUID(); this.owners.set(owner, { root, rel }); return owner;
  }
  valid(root, rel, owner) { const lease = this.owners.get(owner); return lease?.root === root && lease.rel === rel; }
  releaseOwner(owner) { const lease = this.owners.get(owner); if (lease) this.release(lease.root, lease.rel, owner); }
  release(root, rel, owner) {
    if (!this.valid(root, rel, owner)) return;
    this.owners.delete(owner); const lane = this.lanes.get(root); if (!lane) return;
    lane.queue = lane.queue.filter(job => { if (job.owner !== owner) return true; job.reject(closed()); return false; });
    if (lane.current?.owner === owner) { const job = lane.current; lane.current = null; clearTimeout(lane.timer); this.closeProcess(lane); job.reject(closed()); }
    if (![...this.owners.values()].some(lease => lease.root === root)) { this.closeProcess(lane); this.lanes.delete(root); }
    else this.drain(lane);
  }
  closeProcess(lane) {
    clearTimeout(lane.timer); lane.dispose?.(); lane.dispose = null;
    const child = lane.child; lane.child = null; lane.revision = null; lane.tail = ''; if (child) killTree(child);
  }
  fail(lane, error) {
    const jobs = [lane.current, ...lane.queue].filter(Boolean); lane.current = null; lane.queue = []; this.closeProcess(lane);
    for (const job of jobs) job.reject(error);
  }
  restart(root) { const lane = this.lanes.get(root); if (lane) this.fail(lane, Error('ESLint restarted. Run the check again.')); }
  stopAll() { for (const lane of this.lanes.values()) this.fail(lane, closed()); this.lanes.clear(); this.owners.clear(); }
  spawn(lane, revision) {
    if (lane.child && lane.revision === revision) return;
    this.closeProcess(lane);
    if ([...this.lanes.values()].filter(item => item.child).length >= 2) throw Error('Close an unused project’s lint editor before starting another ESLint process.');
    const worker = path.join(__dirname, 'eslint-worker.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const child = start(process.execPath, [worker], { cwd: lane.root, keepOpen: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    lane.child = child; lane.revision = revision; lane.bytes = 0;
    const count = chunk => { lane.bytes += Buffer.byteLength(chunk); if (lane.bytes > 4 * 1024 * 1024) this.fail(lane, Error('ESLint output exceeded its limit.')); };
    child.stdout.on('data', count);
    const offLines = lines(child.stdout, line => {
      const marker = 'TRIBUTARY_ESLINT_RESULT:'; if (!line.startsWith(marker) || lane.child !== child || !lane.current) return;
      let reply; try { reply = JSON.parse(line.slice(marker.length)); } catch { this.fail(lane, Error('Invalid ESLint response.')); return; }
      const job = lane.current; if (reply.id !== job.id) { this.fail(lane, Error('ESLint response does not match the active check.')); return; }
      lane.current = null; clearTimeout(lane.timer);
      if (!this.valid(lane.root, job.rel, job.owner)) job.reject(closed());
      else if (reply.error) job.reject(Error(reply.error));
      else if (!reply.result || !Array.isArray(reply.result.diagnostics) || reply.result.diagnostics.length > 500 || reply.result.output != null && (typeof reply.result.output !== 'string' || Buffer.byteLength(reply.result.output) > 2 * 1024 * 1024)) job.reject(Error('Invalid ESLint result.'));
      else job.resolve(reply.result);
      // Let the worker finish flushing its response before the next request.
      setImmediate(() => this.drain(lane));
    });
    const offTail = streamTail(child.stderr, 2000, tail => { lane.tail = tail; });
    lane.dispose = () => { offLines(); offTail(); child.stdout.off('data', count); child.stdout.resume(); child.stderr.resume(); };
    child.once('error', () => { if (lane.child === child) this.fail(lane, Error('Could not start the project ESLint process.')); });
    child.once('close', code => { if (lane.child === child) this.fail(lane, Error(lane.tail.trim().slice(-500) || `ESLint stopped (${code}).`)); });
  }
  drain(lane) {
    if (lane.current || this.lanes.get(lane.root) !== lane) return;
    const job = lane.queue.shift(); if (!job) return;
    if (!this.valid(lane.root, job.rel, job.owner)) { job.reject(closed()); this.drain(lane); return; }
    try {
      this.spawn(lane, job.revision); lane.current = job; lane.bytes = 0;
      lane.timer = setTimeout(() => this.fail(lane, Error('ESLint timed out. Check the project’s configuration or plugins.')), 15000); lane.timer.unref?.();
      lane.child.stdin.write(JSON.stringify({ id: job.id, root: lane.root, filename: job.filename, rel: job.rel, text: job.text, fix: job.fix, config: job.config.eslint }) + '\n');
    } catch (error) { lane.current = null; job.reject(error); setImmediate(() => this.drain(lane)); }
  }
  async document(root, rel, text, owner, reason = 'type', fix = false) {
    if (!this.valid(root, rel, owner)) throw closed();
    const lease = this.owners.get(owner); const request = lease.request = (lease.request || 0) + 1;
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || text.includes('\0')) throw Error('Lint text files up to 1 MB.');
    const filename = await projectPath(root, rel); const config = await editorSettings(root, rel);
    if (!this.valid(root, rel, owner)) throw closed();
    if (lease.request !== request) return { status: 'cancelled', diagnostics: [] };
    if (!config.eslint.enabled) return { status: 'disabled', diagnostics: [] };
    if (!config.eslint.library) return { status: 'not-installed', diagnostics: [], configured: config.eslint.fixOnSave || config.defaultFormatter === 'dbaeumer.vscode-eslint' || config.sources.some(file => /eslint/i.test(file)) };
    if (!this.trusted(root)) throw Error('Trust this project before loading its ESLint library and plugins.');
    if (!fix && reason === 'type' && config.eslint.run === 'onSave') return { status: 'on-save', diagnostics: [] };
    const stamps = await Promise.all([...config.sources.map(file => path.resolve(root, file)), config.eslint.library].map(async file => { const stat = await fs.stat(file); return [file, stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino]; }));
    if (!this.valid(root, rel, owner)) throw closed();
    if (lease.request !== request) return { status: 'cancelled', diagnostics: [] };
    const revision = JSON.stringify([config.eslint.cwd, config.eslint.library, config.eslint.version, config.eslint.useFlatConfig, config.eslint.changeProcessCwd, stamps]); let lane = this.lanes.get(root);
    if (!lane) { lane = { root, queue: [], current: null, child: null }; this.lanes.set(root, lane); }
    return new Promise((resolve, reject) => {
      if (!fix) lane.queue = lane.queue.filter(job => { if (job.owner !== owner || job.fix) return true; job.resolve({ status: 'cancelled', diagnostics: [] }); return false; });
      if (lane.queue.length >= 16) { reject(Error('Too many pending ESLint checks.')); return; }
      const job = { id: randomUUID(), filename, rel, text, owner, fix, config, revision, resolve, reject };
      if (fix) lane.queue.unshift(job); else lane.queue.push(job); this.drain(lane);
    });
  }
  async fix(root, rel, text) { const owner = this.acquire(root, rel); try { return await this.document(root, rel, text, owner, 'manual', true); } finally { this.release(root, rel, owner); } }
}
module.exports = { EslintTools };
