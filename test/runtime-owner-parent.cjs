'use strict';
const { spawnOwnedRuntime } = require('../core/local-engine-process');
const [cwd, mode] = process.argv.slice(2);
const code = mode === 'flood' ? 'process.stdout.write("X".repeat(32*1024*1024));setInterval(()=>{},1000)' : 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
const child = spawnOwnedRuntime(process.execPath, ['-e', code], { cwd, cleanupDirectory: true });
child.on('error', error => { console.error(error); process.exit(1); });
child.stdout.pause(); child.stderr.resume();
const timer = setInterval(() => {
  if (child.runtimePid) { clearInterval(timer); process.send({ guardianPid: child.pid, runtimePid: child.runtimePid, backend: child.backend }); }
}, 10);
