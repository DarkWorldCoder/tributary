// Real end-to-end check with installed agents. Uses a little of your agent quota.
// usage: node test/e2e/real-handoff.js [agentA] [agentB]
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const { Hub, MemorySecrets } = require('../../core');
(async () => {
  const [A = 'claude', B = 'codex'] = process.argv.slice(2);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-e2e-'));
  execFileSync('git', ['init', '-q'], { cwd: proj }); fs.writeFileSync(path.join(proj, 'README.md'), '# demo\n');
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=e2e@local', '-c', 'user.name=e2e', 'commit', '-qm', 'init'], { cwd: proj });
  const hub = await new Hub({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-data-')), secrets: new MemorySecrets() }).init();
  hub.addProject(proj); const t = hub.createThread(proj);
  const show = (m) => console.log(`[${m.agent}] ok=${m.ok} handoff=${m.handoff} resumed=${m.resumed} files=${m.files.map((f) => f.rel).join(',')} tools=${m.tools.map((x) => `${x.name}:${x.status}`).join(' ')}\n   text=${JSON.stringify(m.text.trim().slice(0, 200))}${m.error ? `\n   error=${m.error.slice(0, 300)}` : ''}`);
  show(await hub.send({ threadId: t.id, agentId: A, mode: 'edit', text: 'Create a file named hello.txt whose only content is the line: alpha. Then reply with just DONE.' }));
  show(await hub.send({ threadId: t.id, agentId: B, mode: 'edit', text: 'Append a second line "beta" to hello.txt. Then reply with just DONE.' }));
  show(await hub.send({ threadId: t.id, agentId: A, mode: 'read', text: 'Without using any tools, based only on what you were told: which agent added the second line and what is it? One short sentence.' }));
  console.log('hello.txt =', JSON.stringify(fs.readFileSync(path.join(proj, 'hello.txt'), 'utf8')));
  console.log('sessions =', JSON.stringify(hub.thread(t.id).agentSessions));
})().catch((e) => { console.error(e); process.exit(1); });
