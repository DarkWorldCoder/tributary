'use strict';
// The real engine must release its memory after its owner crashes, even when
// output backpressure blocks the main thread. No app or performance claim.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { fork } = require('node:child_process');
if (process.argv[2] === '--parent') {
  const { spawn } = require('node:child_process');
  const args = ['scan-files', process.argv[4], 'entry-', '2000', 'true'];
  if (process.argv[5] !== 'control') args.push('--parent-pipe');
  const child = spawn(process.argv[3], args, { stdio: ['pipe', 'inherit', 'ignore'], windowsHide: true });
  child.once('error', error => { console.error(error); process.exit(1); });
  // Deliberately never read stdout, while retaining the owner's input pipe.
  child.once('spawn', () => setTimeout(() => {
    try { process.kill(child.pid, 0); process.send({ childPid: child.pid }); }
    catch { process.exit(1); }
  }, 200));
  setInterval(() => {}, 1000);
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-owner-'));
  const binary = path.resolve(process.argv[2] || path.join(__dirname, 'target/release/tributary-engine' + (process.platform === 'win32' ? '.exe' : '')));
  let parent, nativePid;
  const alive = pid => {
    try {
      process.kill(pid, 0);
      // A crashed owner cannot reap its child. An exited zombie has already
      // released its working memory; the OS owns final PID bookkeeping.
      if (process.platform === 'linux' && /^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))) return false;
      return true;
    } catch (error) { if (['ESRCH', 'ENOENT'].includes(error.code)) return false; throw error; }
  };
  (async () => {
    const folder = 'deep-'.repeat(35); fs.mkdirSync(path.join(root, folder));
    for (let at = 0; at < 2000; at++) fs.closeSync(fs.openSync(path.join(root, folder, 'entry-' + String(at).padStart(6, '0') + '-' + 'x'.repeat(160) + '.ts'), 'w'));
    for (const mode of ['control', 'owned']) {
      // This process keeps the output reader open without consuming it. Parent
      // death therefore cannot unblock the worker through an EPIPE shortcut.
      parent = fork(__filename, ['--parent', binary, root, mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      // Node normally resumes unread child stdio after exit to drain it. This
      // fixture keeps backpressure intact across that cleanup; the unowned
      // control below proves it is still blocked after its parent has exited.
      parent.stdout.resume = () => parent.stdout;
      nativePid = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Native worker did not start')), 10000);
        parent.once('message', message => { clearTimeout(timer); resolve(message.childPid); });
        parent.once('error', reject); parent.once('exit', () => { clearTimeout(timer); reject(Error('Fixture parent exited before its worker was confirmed live')); });
      });
      assert.ok(Number.isSafeInteger(nativePid) && nativePid > 1 && alive(nativePid));
      const exited = new Promise(resolve => parent.once('exit', resolve)); parent.kill('SIGKILL'); await exited;
      if (mode === 'control') {
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.ok(alive(nativePid), 'Without its lifeline the blocked worker must survive parent death');
        process.kill(nativePid, 'SIGKILL');
      }
      const deadline = Date.now() + 5000;
      while (alive(nativePid)) { assert.ok(Date.now() < deadline, 'Native worker survived its owner'); await new Promise(resolve => setTimeout(resolve, 10)); }
      parent.stdout.destroy(); parent.stderr.destroy();
    }
    const report = { complete: true, platform: process.platform, checks: ['A real native worker stays live under output backpressure.', 'The no-lifeline control survives parent death, then is explicitly terminated.', 'Crashing an owned worker parent closes the lifeline and releases the native worker.'], scope: 'Real process ownership, including parent crash and blocked output, with an unowned control. No throughput, RAM peak or full application test.' };
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  })().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
    parent?.kill('SIGKILL'); if (nativePid && alive(nativePid)) process.kill(nativePid, 'SIGKILL'); fs.rmSync(root, { recursive: true, force: true });
  });
}
