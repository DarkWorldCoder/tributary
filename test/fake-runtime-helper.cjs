'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const [mode, state, command, ...args] = process.argv.slice(2);
const record = (name, value) => fs.writeFileSync(path.join(state, name), String(value));
if (command === '--identity') {
  record('probe-pid', process.pid);
  if (mode === 'slow-probe') { setInterval(() => {}, 1000); }
  else if (mode === 'large-probe') { process.stdout.write('x'.repeat(2048)); setInterval(() => {}, 1000); }
  else if (mode === 'failed-probe') process.exitCode = 1;
  else {
    const identity = { protocol: 1, runtime: mode === 'old-probe' ? 0 : 1, arch: mode === 'wrong-arch' ? 'wrong' : { x64: 'x86_64', arm64: 'aarch64' }[process.arch], os: { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform] };
    process.stdout.write(JSON.stringify(identity));
  }
} else if (command === 'guard-runtime') {
  record('guard-pid', process.pid);
  if (args[0] === '--cleanup-owned-cwd') args.shift();
  if (args[0] === '--') args.shift();
  const runtime = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  record('runtime-pid', runtime.pid);
  // A fast runtime can exit before the deliberately fragmented header finishes.
  // Attach immediately: Node drains unconsumed child stdio on exit.
  const output = new PassThrough(), errors = new PassThrough();
  runtime.stdout.pipe(output); runtime.stderr.pipe(errors);
  let runtimeClosed = false, completeHeader;
  const stop = () => { runtime.stdout.resume(); runtime.stderr.resume(); runtime.kill('SIGKILL'); };
  process.stdin.on('data', stop); process.stdin.on('end', stop); process.stdin.resume();
  runtime.on('error', error => { console.error(error.message); });
  runtime.on('close', () => {
    runtimeClosed = true;
    process.exitCode = 1; process.stdin.destroy();
    // This mode makes the ordering deterministic without a timing assumption.
    if (mode === 'exit-before-meta') completeHeader();
  });
  if (mode === 'bad-meta') process.stdout.write('not-metadata\n');
  else if (mode === 'large-meta') process.stdout.write('x'.repeat(2048));
  else if (mode === 'partial-meta') { process.stdout.write('{'); setTimeout(stop, 30); }
  else {
    const header = JSON.stringify({ runtimePid: runtime.pid }) + '\n';
    process.stdout.write(header.slice(0, 6));
    completeHeader = () => {
      if (mode === 'exit-before-meta') record('closed-before-header', runtimeClosed);
      process.stdout.write(header.slice(6)); output.pipe(process.stdout); errors.pipe(process.stderr);
    };
    if (mode !== 'exit-before-meta') setTimeout(completeHeader, 20);
  }
} else process.exitCode = 2;
