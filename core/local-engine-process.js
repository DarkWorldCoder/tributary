'use strict';
// A private IPC channel owns the runtime. Parent death closes it even when
// JavaScript exit handlers cannot run; the small guardian then reaps the model.
const path = require('node:path');
const { fork } = require('node:child_process');
function spawnLegacyRuntime(executable, args, options) {
  const worker = path.join(__dirname, 'local-engine-worker.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  const child = fork(worker, [], { cwd: options.cwd, execArgv: [], windowsHide: true, env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.on('message', message => { if (message?.type === 'runtime-started' && Number.isSafeInteger(message.pid)) child.runtimePid = message.pid; });
  // Do not TerminateProcess the guardian on Windows: request model shutdown
  // over IPC instead, then wait for the guardian's actual close/reap event.
  child.kill = signal => { if (!child.connected) return false; try { child.send({ type: 'stop', force: signal === 'SIGKILL' }, () => {}); return true; } catch { return false; } };
  child.send({ type: 'start', executable, args, cwd: options.cwd, cleanupDirectory: options.cleanupDirectory === true }, error => { if (error) child.emit('error', error); });
  return child;
}
function spawnOwnedRuntime(executable, args, options) {
  const binary = require('./native-engine').engineBinary();
  if (!binary) return spawnLegacyRuntime(executable, args, options);
  return require('./native-engine/runtime.cjs').spawnRuntime(binary, executable, args, options,
    () => spawnLegacyRuntime(executable, args, options));
}
module.exports = { spawnOwnedRuntime };
