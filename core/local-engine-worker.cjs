'use strict';
// Guardian, never a model server or an API proxy. Only its creating process can
// use this IPC channel. No prompts, response buffering, registry or downloads.
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
let runtime = null, directory = null, timer = null, stopping = false;
function stop(force = false) {
  stopping = true;
  if (!runtime) { process.exit(0); return; }
  if (runtime.exitCode === null && !runtime.signalCode) runtime.kill(force ? 'SIGKILL' : 'SIGTERM');
  if (!timer) timer = setTimeout(() => { if (runtime?.exitCode === null && !runtime.signalCode) runtime.kill('SIGKILL'); }, 1000);
}
process.on('disconnect', () => stop());
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
process.stdout.on('error', () => stop()); process.stderr.on('error', () => stop());
process.on('exit', () => { if (runtime?.pid && runtime.exitCode === null && !runtime.signalCode) try { runtime.kill('SIGKILL'); } catch {} });
process.on('message', message => {
  if (message?.type === 'stop') { stop(message.force === true); return; }
  if (message?.type !== 'start' || runtime || stopping) return;
  directory = message.cwd;
  try {
    runtime = spawn(message.executable, message.args, { cwd: directory, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    runtime.stdout.pipe(process.stdout); runtime.stderr.pipe(process.stderr);
    runtime.once('spawn', () => { if (process.connected) process.send({ type: 'runtime-started', pid: runtime.pid }); else stop(); });
    runtime.once('error', error => { console.error(error.message); });
    runtime.once('close', code => {
      clearTimeout(timer);
      // The manager creates this private directory, which contains only its
      // ephemeral key. Clean it even when the manager itself has disappeared.
      if (path.isAbsolute(directory) && path.basename(directory).startsWith('local-engine-')) try { process.chdir(path.dirname(directory)); fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      process.exit(stopping ? 0 : code || 1);
    });
  } catch (error) { console.error(error.message); process.exit(1); }
});
