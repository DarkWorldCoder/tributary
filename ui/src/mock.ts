// Browser-only mock host so the UI can be developed and previewed without Electron or VS Code.
import type { AgentMessage, HubBridge, HubState, Thread, UserMessage } from './types';

export function createMockHub(): HubBridge {
  const L: Record<string, ((d: any) => void)[]> = {};
  const emit = (e: string, d?: unknown) => (L[e] || []).forEach((f) => f(d));
  const proj = '/home/me/projects/shop'; const now = Date.now();
  const st: HubState = {
    agents: [
      { id: 'claude', glyph: 'Cl', name: 'Claude Code', vendor: 'Anthropic', color: '#d97757', available: true, headless: true, protocol: 'claude-stream', verified: true, version: '2.1.292', path: '~/.local/bin/claude', gateways: ['anthropic'] },
      { id: 'codex', glyph: 'Cx', name: 'Codex', vendor: 'OpenAI', color: '#10a37f', available: true, headless: true, protocol: 'codex-exec', verified: true, version: 'codex-cli 0.163.0', path: '/usr/lib/chatgpt/resources/codex', gateways: ['openai', 'ollama', 'lmstudio'] },
      { id: 'gemini', glyph: 'Ge', name: 'Gemini CLI', vendor: 'Google', color: '#4285f4', available: true, headless: true, protocol: 'gemini-stream', verified: true, version: '0.64.0', path: '/usr/bin/gemini', gateways: ['gemini'], note: 'Personal Google sign-in was retired for Gemini CLI. Use a Gemini API key gateway or Antigravity.' },
      { id: 'antigravity', glyph: 'Ag', name: 'Antigravity CLI', vendor: 'Google', color: '#7c4dff', available: true, headless: true, protocol: 'agy-stream', verified: true, version: '1.4.12', path: '~/.local/bin/agy', gateways: ['gemini'] },
      { id: 'opencode', glyph: 'Oc', name: 'OpenCode', vendor: 'SST', color: '#f5a623', available: false, headless: true, protocol: 'acp', gateways: ['openai', 'anthropic', 'ollama'] },
      { id: 'deepseek-tui', glyph: 'Ds', name: 'DeepSeek TUI', vendor: 'Community', color: '#4d6bfe', available: false, headless: false, protocol: 'text', gateways: [] },
    ],
    projects: [{ path: proj, name: 'shop' }, { path: '/home/me/projects/api', name: 'api' }],
    gateways: [{ id: 'g1', name: 'Local LiteLLM', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', model: 'qwen3-coder', hasKey: false }, { id: 'g2', name: 'DeepSeek', protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat', hasKey: true }],
    presets: [
      { name: 'LiteLLM proxy (OpenAI style)', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', model: '' },
      { name: 'Ollama (OpenAI style)', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3-coder' },
      { name: 'DeepSeek (Anthropic style)', protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
    ],
    settings: {}, running: [], customAgentsFile: '/home/me/.config/Tributary/agents.json', unread: 2,
    recipes: { 'plan-build-review': { name: 'Plan, build, review', description: '', roles: [] }, 'build-review': { name: 'Build and review', description: '', roles: [] }, council: { name: 'Ask everyone', description: '', roles: [] } },
  };
  const t1: Thread = { id: 't1', project: proj, title: 'Add login rate limiting', agentSessions: { claude: 'a', codex: 'b' }, updatedAt: now - 6e4, messages: [
    { id: 'u1', role: 'user', text: 'Add rate limiting to POST /login: 5 tries per minute per IP.', target: 'claude' },
    { id: 'a1', role: 'assistant', agent: 'claude', mode: 'edit', handoff: 'new', ok: true, durationMs: 41200, costUsd: 0.214, usage: { input_tokens: 18000, output_tokens: 900 }, notices: [],
      text: 'Added a sliding-window limiter in `src/middleware/rateLimit.ts` and wired it into the login route.\n\n- 5 attempts per 60 seconds per IP\n- Returns **429** with a `Retry-After` header\n\n```ts\napp.post("/login", rateLimit({ max: 5, windowMs: 60_000 }), login);\n```',
      tools: [{ id: 'x1', name: 'Read', input: { file_path: `${proj}/src/routes/auth.ts` }, status: 'done', output: 'export async function login(req, res) {…}' },
        { id: 'x2', name: 'Write', input: { file_path: `${proj}/src/middleware/rateLimit.ts` }, status: 'done', output: 'File created' },
        { id: 'x3', name: 'Edit', input: { file_path: `${proj}/src/routes/auth.ts` }, status: 'done', output: 'Applied edit' }],
      files: [{ rel: 'src/middleware/rateLimit.ts', path: `${proj}/src/middleware/rateLimit.ts`, change: '??' }, { rel: 'src/routes/auth.ts', path: `${proj}/src/routes/auth.ts`, change: 'M' }] },
    { id: 'u2', role: 'user', text: 'Write tests for the limiter and run them.', target: 'codex' },
    { id: 'a2', role: 'assistant', agent: 'codex', mode: 'edit', handoff: 'join', ok: true, durationMs: 63800, usage: { input_tokens: 24000, output_tokens: 1200 }, notices: [],
      text: 'Added `test/rateLimit.test.ts` with four cases. All pass.', plan: [{ text: 'Read the limiter', done: true }, { text: 'Write tests', done: true }, { text: 'Run the test suite', done: true }],
      checkpoint: 'abc123', tools: [{ id: 'y1', name: 'shell', input: { command: 'npm test -- rateLimit' }, status: 'done', output: 'PASS test/rateLimit.test.ts\n  ✓ allows 5 requests\n  ✓ blocks the 6th\n  ✓ resets after the window\n  ✓ sets Retry-After' },
        { id: 'y2', name: 'edit', input: { changes: [{ path: `${proj}/test/rateLimit.test.ts` }] }, status: 'done' }],
      files: [{ rel: 'test/rateLimit.test.ts', path: `${proj}/test/rateLimit.test.ts`, change: 'add' }] },
  ] };
  const threads: Record<string, Thread> = { t1 };
  const seen = new Set<string>();
  const summaries = () => ({
    [proj]: [{ id: 't1', title: t1.title, updatedAt: t1.updatedAt!, lastAgent: 'codex', agents: ['claude', 'codex'], running: st.running.includes('t1'), status: st.running.includes('t1') ? 'working' : seen.has('t1') ? 'done' : 'review' },
      { id: 't2', title: 'Fix flaky checkout test', updatedAt: now - 3 * 3600e3, lastAgent: 'gemini', agents: ['gemini'], status: 'failed' },
      { id: 't3', title: 'Upgrade to Node 24', updatedAt: now - 2 * 86400e3, lastAgent: 'antigravity', agents: ['claude', 'antigravity'], status: 'done' }],
    '/home/me/projects/api': [{ id: 't4', title: 'Pagination for /orders', updatedAt: now - 5 * 86400e3, lastAgent: 'codex', agents: ['codex'], status: seen.has('t4') ? 'done' : 'review' }],
  } as Record<string, any[]>);
  const git = { root: proj, branch: 'main', changed: [{ code: 'M', path: 'src/routes/auth.ts' }, { code: '??', path: 'src/middleware/rateLimit.ts' }, { code: '??', path: 'test/rateLimit.test.ts' }] };
  const registry = [
    { id: 'qwen-code', name: 'Qwen Code', version: '0.4.1', description: 'Alibaba\'s coding agent for Qwen3-Coder models.', website: 'https://github.com/QwenLM/qwen-code', install: { kind: 'npx' as const, runnable: true } },
    { id: 'fast-agent', name: 'fast-agent', version: '0.3.2', description: 'Define, prompt and test MCP-enabled agents and workflows.', website: 'https://fast-agent.ai', install: { kind: 'uvx' as const, runnable: true } },
    { id: 'goose', name: 'Goose', version: '1.9.0', description: 'An open source, extensible AI agent that goes beyond code suggestions.', website: 'https://block.github.io/goose', install: { kind: 'binary' as const, runnable: false } },
  ];
  let seq = 10;
  const api: Record<string, (...a: any[]) => unknown> = {
    state: () => st, rescan: () => st.agents, pickProject: () => proj, removeProject: () => undefined,
    threads: (p: string) => (summaries()[p] || []).map((x) => ({ ...x, branch: threads[x.id]?.worktree?.branch })),
    thread: (id: string) => threads[id] || { id, project: id === 't4' ? '/home/me/projects/api' : proj, title: summaries()[proj].find((x) => x.id === id)?.title || 'Thread', messages: [], agentSessions: {} },
    createThread: (p: string) => { const t: Thread = { id: `t${++seq}`, project: p, title: 'New thread', messages: [], agentSessions: {} }; threads[t.id] = t; return t; },
    renameThread: (id: string, title: string) => { if (threads[id]) threads[id].title = title; },
    markThreadSeen: (id: string) => { const p = id === 't4' ? '/home/me/projects/api' : proj; if (!seen.has(id)) { seen.add(id); setTimeout(() => emit('threads', p)); } },
    deleteThread: () => undefined, gitInfo: () => git,
    fileDiff: (_p: string, r: string) => `diff --git a/${r} b/${r}\nindex 3f2a1b0..9c8d7e6 100644\n--- a/${r}\n+++ b/${r}\n@@ -1,5 +1,7 @@\n import express from "express";\n+import { rateLimit } from "../middleware/rateLimit";\n import { login } from "./handlers";\n \n-app.post("/login", login);\n+app.post("/login", rateLimit({ max: 5, windowMs: 60_000 }), login);\n+\n export default app;`,
    saveGateway: () => 'g3', deleteGateway: () => undefined, setSettings: () => undefined, syncInstructions: () => ['AGENTS.md', 'CLAUDE.md'],
    listFiles: () => ['src/routes/auth.ts', 'src/middleware/rateLimit.ts', 'src/server.ts', 'test/rateLimit.test.ts', 'package.json', 'README.md', 'AGENTS.md'],
    skills: () => [{ name: 'pdf', title: 'pdf', description: 'Read, fill and create PDF files', agents: ['claude', 'codex'] }, { name: 'frontend-design', title: 'frontend-design', description: 'Distinctive, intentional visual design for new UI', agents: ['antigravity', 'claude', 'codex', 'gemini'] }, { name: 'xlsx', title: 'xlsx', description: 'Spreadsheets with formulas and charts', agents: ['claude'] }],
    shareSkill: () => ['~/.agents/skills/xlsx'],
    mcp: () => [{ agent: 'claude', name: 'github', scope: 'user', enabled: true, transport: 'stdio', target: 'github-mcp-server stdio', envKeys: ['GITHUB_TOKEN'] }, { agent: 'codex', name: 'github', scope: 'user', enabled: true, transport: 'stdio', target: 'github-mcp-server stdio' }, { agent: 'codex', name: 'Figma', scope: 'user', enabled: true, transport: 'http', target: 'https://mcp.figma.com/mcp' }, { agent: 'antigravity', name: 'StitchMCP', scope: 'user', enabled: true, transport: 'stdio', target: 'npx -y mcp-remote https://stitch.googleapis.com/mcp --header X-Goog-Api-Key: •••' }],
    addMcp: (srv: any, ids: string[]) => ids.map((agent) => ({ agent, ok: true, message: `Added ${srv.name}` })),
    removeMcp: (agent: string) => ({ agent, ok: true, message: 'Removed' }),
    registry: () => ({ source: 'network', agents: registry.map((a) => ({ ...a, installed: st.agents.some((x) => x.id === `acp:${a.id}`) })) }),
    installRegistryAgent: (id: string) => { const a = registry.find((x) => x.id === id)!; st.agents.push({ id: `acp:${id}`, name: a.name, color: '#0ea5e9', available: true, headless: true, protocol: 'acp', registry: id }); return { id: `acp:${id}` }; },
    removeRegistryAgent: (id: string) => { st.agents = st.agents.filter((x) => x.id !== `acp:${id}`); return true; },
    commit: (_p: string, msg: string) => `[main 4f2c1aa] ${msg}`,
    restoreCheckpoint: () => ({ restored: 2, removed: 1 }),
    notifications: () => [
      { id: 'n1', ts: now - 120e3, read: false, kind: 'attention', threadId: 't1', title: 'Race finished: pick a result', body: 'Tests passed for Claude Code, Codex.' },
      { id: 'n2', ts: now - 600e3, read: false, kind: 'done', threadId: 't1', title: 'Codex finished', body: 'Add login rate limiting' },
      { id: 'n3', ts: now - 3600e3, read: true, kind: 'failed', threadId: 't2', title: 'Gemini CLI stopped with an error', body: 'Fix flaky checkout test' },
    ],
    markRead: () => { st.unread = 0; }, clearNotifications: () => undefined,
    threadChanges: () => [
      { rel: 'src/routes/auth.ts', turns: [{ messageId: 'a1', agent: 'claude', ts: now - 9e5, change: 'M' }] },
      { rel: 'src/middleware/rateLimit.ts', turns: [{ messageId: 'a1', agent: 'claude', ts: now - 9e5, change: 'A' }] },
      { rel: 'test/rateLimit.test.ts', turns: [{ messageId: 'a2', agent: 'codex', ts: now - 3e5, change: 'A' }] },
    ],
    turnDiff: (_t: string, _m: string, rel: string) => `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -0,0 +1,4 @@\n+import { rateLimit } from "./rateLimit";\n+test("blocks the 6th request", () => {\n+  expect(hit(6)).toBe(429);\n+});`,
    readFile: (_p: string, rel: string) => ({ rel, size: 420, binary: false, truncated: false, mtime: 1, content: rel.endsWith('.md')
      ? '# Shop\n\nA small store API.\n\n- Run `npm run dev`\n- Tests: `npm test`\n' : `import express from "express";\nimport { rateLimit } from "../middleware/rateLimit";\nimport { login } from "./handlers";\n\nconst app = express();\n\n// Five tries per minute per IP\napp.post("/login", rateLimit({ max: 5, windowMs: 60_000 }), login);\n\nexport default app;\n` }),
    writeFile: () => ({ mtime: 2 }),
    memory: () => ({ enabled: true, memory: '# Project memory\n\n## Decisions\n- Use pnpm, not npm\n- Rate limits live in src/middleware\n\n## How to run and test\n- pnpm dev, pnpm test\n', worklog: ['- 2026-11-02 16:20 Claude Code: "Add rate limiting". Changed `src/routes/auth.ts`, `src/middleware/rateLimit.ts`', '- 2026-11-02 16:31 Codex: "Write tests". Changed `test/rateLimit.test.ts`'] }),
    enableMemory: () => ['.tributary/memory.md'], saveMemory: () => true, remember: () => 'ok',
    editors: () => [{ id: 'vscode', name: 'VS Code' }, { id: 'cursor', name: 'Cursor' }], openInEditor: () => true,
    setProjectFolders: (path: string, folders: string[]) => { const project = st.projects.find((entry) => entry.path === path); if (project) project.folders = folders; emit('state'); return folders; }, pickFolder: () => null,
    renameProject: (path: string, name: string) => { const project = st.projects.find((entry) => entry.path === path); if (!project) throw new Error('Unknown project'); project.name = name.trim(); emit('state'); return project.name; },
    runTeam: () => ({}), applyRace: () => ({ applied: 'claude' }),
    createWorktree: (id: string) => {
      const t = threads[id] || (threads[id] = api.thread(id) as Thread); const branch = `tributary/thread-${id.padEnd(8, '0').slice(0, 8)}`;
      t.worktree = { path: `/home/me/.config/Tributary/worktrees/thread-${id}/shop`, cwd: `/home/me/.config/Tributary/worktrees/thread-${id}/shop`, branch, base: '4f2c1aa', from: 'main', createdAt: now };
      setTimeout(() => emit('threads', t.project));
      return api.worktreeStatus(id);
    },
    worktreeStatus: (id: string) => ({ branch: threads[id]?.worktree?.branch, path: threads[id]?.worktree?.path, cwd: threads[id]?.worktree?.cwd, into: 'main', ahead: 0, behind: 1, uncommitted: 2, files: [{ path: 'src/routes/auth.ts', code: 'M' }, { path: 'test/auth.test.ts', code: 'A' }] }),
    mergeWorktree: (id: string) => { throw new Error(`Can't merge cleanly: these files conflict with changes made on main since this conversation started: src/routes/auth.ts. The work is kept on branch ${threads[id]?.worktree?.branch} so you or an agent can merge it.`); },
    discardWorktree: (id: string) => { const t = threads[id]; if (t) { delete t.worktree; setTimeout(() => emit('threads', t.project)); } return true; },
    runRace: async (threadId: string, o: any) => {
      const t = threads[threadId];
      const u: UserMessage = { id: `u${Date.now()}`, role: 'user', text: o.task, target: o.agents.join(','), kind: 'race' };
      const m: AgentMessage = { id: `r${Date.now()}`, role: 'assistant', agent: 'race', kind: 'race', mode: 'edit', ok: null, text: '', tools: [], files: [], notices: [],
        race: { task: o.task, testCommand: o.testCommand || '', agents: o.agents, applied: null, candidates: o.agents.map((a: string) => ({ agent: a, status: 'running', activity: 'Edit src/routes/auth.ts' })) } };
      t.messages.push(u, m); st.running = [threadId]; emit('message', { threadId, message: u }); emit('message', { threadId, message: { ...m } }); emit('running', { threadId, running: true });
      await new Promise((r) => setTimeout(r, 1500));
      m.race!.candidates = o.agents.map((a: string, i: number) => ({ agent: a, status: 'done', ok: true, tests: o.testCommand ? (i === 1 ? 'failed' : 'passed') : 'skipped', files: ['src/routes/auth.ts', 'test/auth.test.ts'].slice(0, i + 1), stat: ' 2 files changed, 18 insertions(+), 3 deletions(-)', durationMs: 42000 + i * 9000,
        text: `Done by ${a}. I tightened the window check and added a test.`, testOutput: i === 1 ? 'FAIL test/auth.test.ts\n  expected 429, got 200' : 'PASS test/auth.test.ts (4 tests)', diff: 'diff --git a/src/routes/auth.ts b/src/routes/auth.ts\n@@ -7,1 +7,1 @@\n-app.post("/login", login);\n+app.post("/login", rateLimit({ max: 5, windowMs: 60_000 }), login);' }));
      m.ok = true; st.running = []; emit('message', { threadId, message: { ...m, race: { ...m.race! } } }); emit('running', { threadId, running: false });
      return { ok: true };
    },
    createTerminal: () => 'term1', termWrite: () => undefined, termResize: () => undefined, termKill: () => undefined, exportThread: () => null,
    openFile: () => undefined, openDiff: () => false, openAgentsFile: () => undefined, openExternal: () => undefined, stop: () => undefined,
    async send({ threadId, agentId, text, mode, gatewayId }: any) {
      const t = threads[threadId];
      const u: UserMessage = { id: `u${Date.now()}`, role: 'user', text, target: agentId }; t.messages.push(u); emit('message', { threadId, message: u });
      const m: AgentMessage = { id: `a${Date.now()}`, role: 'assistant', agent: agentId, mode, handoff: t.messages.length > 1 ? 'catch-up' : 'new', ok: null, text: '', tools: [], files: [], notices: [],
        gateway: gatewayId ? st.gateways.find((g) => g.id === gatewayId)?.name : null };
      t.messages.push(m); st.running = [threadId]; emit('running', { threadId, running: true }); emit('message', { threadId, message: { ...m } });
      await new Promise((r) => setTimeout(r, 400));
      m.tools = [{ id: 'z1', name: 'shell', input: { command: 'npm test -- rateLimit' }, status: 'running' }]; emit('message', { threadId, message: { ...m } });
      await new Promise((r) => setTimeout(r, 900));
      m.tools = [{ ...m.tools[0], status: 'done', output: 'PASS test/rateLimit.test.ts (4 tests)' }]; emit('message', { threadId, message: { ...m } });
      for (const w of 'I checked the limiter against the new tests. Everything is consistent, so I only tightened the window check to use `>=`.'.split(' ')) {
        await new Promise((r) => setTimeout(r, 45)); m.text += `${w} `; emit('message', { threadId, message: { ...m } });
      }
      m.ok = true; m.durationMs = 3200; st.running = []; emit('message', { threadId, message: { ...m } }); emit('running', { threadId, running: false });
      return { id: m.id, ok: true };
    },
  };
  return { platform: 'mock', call: async (m: string, ...a: unknown[]) => api[m](...a) as any, on: (e, f) => { (L[e] = L[e] || []).push(f as any); } };
}
