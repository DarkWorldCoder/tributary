'use strict';
// Parent-death fixture: the test kills this owner with SIGKILL, so none of its
// JavaScript exit hooks can be responsible for cleaning up the owned runtime.
const path = require('node:path');
const { LocalEngine } = require('../core/local-engine'), { spawnOwnedRuntime } = require('../core/local-engine-process');
const root = process.argv[2], fixture = path.join(__dirname, 'fake-local-engine.cjs');
const engine = new LocalEngine({ dataDir: root, startupMs: 3000, spawnImpl: (file, args, options) => spawnOwnedRuntime(file, [fixture, ...args], options) });
engine.start({ serverPath: process.execPath, modelPath: path.join(root, 'model.gguf'), context: 1024, idleSeconds: 60, threads: 1 }).then(() => {
  process.send({ guardianPid: engine.child.pid, runtimePid: engine.child.runtimePid });
}).catch(error => { console.error(error.stack); process.exit(1); });
