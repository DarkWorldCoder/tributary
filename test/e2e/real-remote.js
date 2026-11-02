#!/usr/bin/env node
// Smoke test of SSH remote-host mode against a real host. Changes nothing in the repository: it
// reads git status, takes one checkpoint (stored in ~/.local/share/tributary on the host), starts
// and stops a throwaway process group, and lists listening ports.
// Usage: node test/e2e/real-remote.js user@host-or-alias /path/to/a/git/repo/on/the/host
const { connect, sshHost } = require('../../core/host');
const { gitInfo } = require('../../core/git');
const { createCheckpoint, changedBetween } = require('../../core/checkpoint');
const { listPorts } = require('../../core/ports');

const [target, dir] = process.argv.slice(2);
if (!target || !dir) { console.error('Usage: node test/e2e/real-remote.js user@host /path/to/repo/on/host'); process.exit(2); }
const step = async (name, fn) => {
  const t = Date.now();
  try { const out = await fn(); console.log(`ok   ${name} (${Date.now() - t} ms)${out ? `: ${out}` : ''}`); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

(async () => {
  const host = sshHost({ target, path: dir });
  await step('connect (opens the shared connection)', () => connect({ target }).then(() => ''));
  await step('10 commands over the shared connection', async () => { const t = Date.now(); for (let i = 0; i < 10; i++) await host.exec('true', []); return `${Math.round((Date.now() - t) / 10)} ms each`; });
  await step('agents on the host PATH', async () => (await host.exec('sh', ['-c', 'for b in claude codex gemini agy opencode node git; do command -v "$b" >/dev/null && printf "%s " "$b"; done'])).stdout.trim() || 'none');
  await step('git status', async () => { const g = await gitInfo(dir, { host }); if (!g) throw new Error(`${dir} is not a git repository`); return `${g.branch}, ${g.changed.length} changed`; });
  await step('checkpoint', async () => { const c = await createCheckpoint(dir, 'e2e', { host }); return `${c.slice(0, 10)}, ${(await changedBetween(dir, c, null, { host })).length} changed since`; });
  await step('stop kills the remote process group', async () => {
    const child = host.spawn('sh', ['-c', 'sleep 300 & echo $!; sleep 300']);
    const pid = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
    host.kill(child);
    await new Promise((resolve) => child.once('close', resolve));
    const alive = await host.exec('kill', ['-0', pid]);
    if (alive.code === 0) throw new Error(`background process ${pid} is still running`);
  });
  await step('listening ports', async () => (await listPorts(host)).map((p) => `${p.port} (${p.command.slice(0, 40)})`).join(', ') || 'none');
})();
