// Real race with installed agents. Uses a little of your agent quota.
// usage: node test/e2e/real-race.js <dataDir> <projectDir> [agentA] [agentB]
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { Hub, MemorySecrets } = require('../../core');
(async () => {
  const [dataDir, proj, A = 'claude', B = 'codex'] = process.argv.slice(2);
  fs.mkdirSync(proj, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'calc.js'), 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n');
  fs.writeFileSync(path.join(proj, 'test.js'), "const { add } = require('./calc');\nif (add(2, 3) !== 5) { console.error('add(2, 3) should be 5, got', add(2, 3)); process.exit(1); }\nconsole.log('ok');\n");
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=e2e@local', '-c', 'user.name=e2e', 'commit', '-qm', 'init'], { cwd: proj });
  const hub = await new Hub({ dataDir, secrets: new MemorySecrets() }).init();
  hub.addProject(proj); const t = hub.createThread(proj);
  const r = await hub.runRace(t.id, { task: 'calc.js has a bug in add(). Fix it. Keep the change minimal and reply in one sentence.', agents: [A, B], testCommand: 'node test.js' });
  for (const c of r.candidates) console.log(`${c.agent}: ok=${c.ok} tests=${c.tests} files=${(c.files || []).join(',')} branch=${c.branch} ${c.error ? `error=${c.error.slice(0, 120)}` : ''}\n   reply=${JSON.stringify((c.text || '').trim().slice(0, 140))}`);
  const win = r.candidates.find((c) => c.tests === 'passed');
  if (win) {
    const msg = hub.thread(t.id).messages.find((m) => m.role === 'assistant' && m.kind === 'race');
    await hub.applyRace(t.id, msg.id, win.agent);
    console.log(`applied ${win.agent}; calc.js now:\n${fs.readFileSync(path.join(proj, 'calc.js'), 'utf8')}`);
  }
  console.log('branches:', execFileSync('git', ['branch', '--list', 'tributary/*'], { cwd: proj, encoding: 'utf8' }).trim().replace(/\n\s*/g, ' | '));
  console.log('worktrees:', execFileSync('git', ['worktree', 'list'], { cwd: proj, encoding: 'utf8' }).trim().split('\n').length);
  hub.store.save(true);
})().catch((e) => { console.error(e); process.exit(1); });
