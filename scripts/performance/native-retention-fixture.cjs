'use strict';
// Synthetic data only. Creates a disposable profile; does not initialize any
// provider, launch the app, or send a model request.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Hub } = require('../../core/hub'); const { MemorySecrets } = require('../../core/store');
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-process-tree-')); const profile = path.join(root, 'profile');
  const hub = new Hub({ dataDir: profile, home: root, secrets: new MemorySecrets() }); const projects = []; const chats = [];
  try {
    for (let projectIndex = 0; projectIndex < 6; projectIndex++) {
      const project = path.join(root, `project-${projectIndex}`); fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, 'README.md'), `# Memory project ${projectIndex}\n\nDisposable performance fixture.\n`);
      fs.writeFileSync(path.join(project, 'main.ts'), Array.from({ length: 2500 }, (_, index) => `export const item_${index} = "project_${projectIndex}_value_${index}";`).join('\n') + '\n');
      projects.push(project); const thread = hub.createThread(project, `Memory project ${projectIndex}`);
      for (let turn = 0; turn < 12; turn++) {
        thread.messages.push({ id: `user-${projectIndex}-${turn}`, role: 'user', target: 'claude', text: `Review fixture step ${turn} for project ${projectIndex}.`, ts: Date.now() + turn * 2 });
        const text = Array.from({ length: 40 }, (_, index) => `Fixture paragraph ${index}: this is saved synthetic project context for repeated read-only chat views, not a model response.`).join('\n\n');
        thread.messages.push({ id: `reply-${projectIndex}-${turn}`, role: 'assistant', agent: 'claude', mode: 'edit', text, tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, durationMs: 1000, ts: Date.now() + turn * 2 + 1 });
      }
      chats.push({ id: thread.id, title: thread.title });
    }
    hub.store.save(true); return { root, profile, projects, chats };
  } finally { hub.fileWatches.close(); hub.store.close(); }
}
if (require.main === module) {
  try { const output = process.argv[2]; if (process.argv.length > 3) throw new Error('Usage: node scripts/performance/native-retention-fixture.cjs [output.json]'); const result = JSON.stringify(createFixture(), null, 2) + '\n'; if (output) fs.writeFileSync(output, result); process.stdout.write(result); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createFixture };
