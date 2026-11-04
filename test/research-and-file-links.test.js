'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkdtemp } = require('./helpers/tmp');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { runTurn } = require('../core/runner');

test('tool references resolve structured, shell and URI paths within the current workspace', async () => {
  const { toolFileReferences: refs } = await import('../ui/src/lib/tool-file-references.mjs');
  assert.deepEqual(refs({ name: 'Read', input: { file_path: '/repo/src/a.ts', offset: 12 } }, '/repo'), [{ rel: 'src/a.ts', line: 12, column: undefined }]);
  assert.equal(refs({ name: 'Read', input: { file_path: 'docs/file with spaces.md' } }, '/repo')[0].rel, 'docs/file with spaces.md');
  assert.equal(refs({ name: 'edit', input: { uri: 'file:///repo/docs/file%20one.md' } }, '/repo')[0].rel, 'docs/file one.md');
  assert.equal(refs({ name: 'Read', input: { file_path: 'C:\\Work\\app\\main.rs' } }, 'C:\\Work\\app')[0].rel, 'main.rs');
  assert.deepEqual(refs({ name: 'Bash', input: { command: 'cd /repo && sed -n "1,12p" src/main.rs && cat README.md' } }, '/repo').map((x) => x.rel), ['src/main.rs', 'README.md']);
  assert.equal(refs({ name: 'edit', input: { changes: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] }, files: ['src/a.ts'] }, '/repo').length, 2);
  for (const file_path of ['/repo-other/a.ts', '/other/private.env', '../outside.ts', 'https://example.com/a.ts', 'bad\0file', 'file://other/repo/a.ts']) assert.deepEqual(refs({ name: 'Read', input: { file_path } }, '/repo'), []);
  assert.deepEqual(refs({ name: 'read_directory', input: { path: 'src' } }, '/repo'), []);
});

function researchHub(t) {
  const root = mkdtemp('research');
  const hub = new Hub({ dataDir: path.join(root, 'data'), home: root, secrets: new MemorySecrets() });
  const project = path.join(root, 'project'); fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'keep.txt'), 'unchanged');
  hub.addProject(project);
  hub.agents = [{ id: 'probe', name: 'Probe', protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
    args: ({ mode, resumeId }) => ['-e', `let prompt='';process.stdin.on('data',c=>prompt+=c).on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:${JSON.stringify(`probe-${mode}`)}}));console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:JSON.stringify({mode:${JSON.stringify(mode)},resumeId:${JSON.stringify(resumeId)},prompt})}}));console.log(JSON.stringify({type:'turn.completed'}));});`] }];
  t.after(() => hub.store.close());
  return { hub, project, thread: hub.createThread(project) };
}

test('Deep research forces read-only, keeps concise transcript metadata and isolates its native session', async (t) => {
  const { hub, project, thread } = researchHub(t);
  await hub.send({ threadId: thread.id, agentId: 'probe', text: 'Initial work', mode: 'edit' });
  const result = await hub.send({ threadId: thread.id, agentId: 'probe', text: 'Compare battery technologies', mode: 'full', research: true });
  const received = JSON.parse(result.text);
  assert.equal(result.kind, 'research'); assert.equal(result.mode, 'read'); assert.equal(received.mode, 'read'); assert.equal(received.resumeId, null);
  assert.match(received.prompt, /web-search and webpage-reading tools/); assert.match(received.prompt, /Never invent sources/); assert.match(received.prompt, /Question: Compare battery technologies/);
  assert.equal(thread.messages.at(-2).text, 'Compare battery technologies'); assert.equal(thread.messages.at(-2).kind, 'research');
  assert.equal(fs.readFileSync(path.join(project, 'keep.txt'), 'utf8'), 'unchanged');
  const next = await hub.send({ threadId: thread.id, agentId: 'probe', text: 'Continue normal work', mode: 'edit' });
  assert.equal(JSON.parse(next.text).resumeId, 'probe-edit');
});

test('Deep research rejects tool-less connections and conflicting Plan requests before starting', async (t) => {
  const { hub, thread } = researchHub(t);
  await assert.rejects(hub.send({ threadId: thread.id, agentId: 'probe', text: 'Question', research: true, plan: true }), /Choose Plan or Deep research/);
  hub.agents[0].capabilities = { tools: false };
  await assert.rejects(hub.send({ threadId: thread.id, agentId: 'probe', text: 'Question', research: true }), /web tools/);
  assert.equal(thread.messages.length, 0); assert.equal(hub.running.size, 0);
});

test('native Codex Research enables live web search while retaining the read-only sandbox', async () => {
  const script = `const rl=require('node:readline').createInterface({input:process.stdin});let config;const out=x=>console.log(JSON.stringify(x));rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')out({id:m.id,result:{}});else if(m.method==='thread/start'){config=m.params;out({id:m.id,result:{thread:{id:'research'}}});}else if(m.method==='turn/start'){out({id:m.id,result:{turn:{id:'turn'}}});out({method:'item/completed',params:{threadId:'research',item:{id:'web',type:'webSearch',query:'topic',status:'completed'}}});out({method:'item/completed',params:{threadId:'research',item:{id:'answer',type:'agentMessage',text:JSON.stringify({search:config.config.web_search,sandbox:config.sandbox,turnSandbox:m.params.sandboxPolicy.type})}}});out({method:'turn/completed',params:{threadId:'research',turn:{id:'turn',status:'completed'}}});}});rl.on('close',()=>process.exit(0));`;
  const events = [];
  const result = await runTurn({ agent: { id: 'probe', protocol: 'codex-exec', controlProtocol: 'codex-app-server', available: true, path: process.execPath, serverArgs: ['-e', script] }, cwd: mkdtemp('research-native'), prompt: 'Research topic', mode: 'read', research: true, onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.text), { search: 'live', sandbox: 'read-only', turnSandbox: 'readOnly' });
  assert.ok(events.some((event) => event.kind === 'tool' && event.name === 'web_search'));
});

test('approval cards split replies at their original request position and preserve equal-offset order', async () => {
  const { replySegments } = await import('../ui/src/lib/reply-segments.mjs');
  const requests = [{ id: 'a', textOffset: 6 }, { id: 'b', textOffset: 6 }, { id: 'old' }];
  const parts = replySegments('BeforeAfter', requests);
  assert.deepEqual(parts, [{ kind: 'text', text: 'Before' }, { kind: 'permission', request: requests[0] }, { kind: 'permission', request: requests[1] }, { kind: 'text', text: 'After' }, { kind: 'permission', request: requests[2] }]);
  assert.equal(parts.filter((p) => p.kind === 'text').map((p) => p.text).join(''), 'BeforeAfter');
  assert.deepEqual(replySegments('Text', [{ textOffset: -1 }, { textOffset: 1000 }]).map((p) => p.kind), ['permission', 'text', 'permission']);
});

test('approval requests capture the already-rendered text offset before later output arrives', async (t) => {
  const { hub, thread } = researchHub(t);
  const msg = { id: 'position', text: 'I checked the files.\n\n', permissions: [], notices: [] };
  thread.messages.push(msg);
  const answer = hub.askPermission(thread, msg, hub.agents[0], { title: 'Check project', kind: 'execute', command: 'fixture-check', options: [] }, new AbortController().signal);
  const request = msg.permissions[0];
  assert.equal(request.textOffset, msg.text.length);
  msg.text += 'Now the checks passed.';
  hub.answerPermission(request.id, 'once'); await answer;
  const { replySegments } = await import('../ui/src/lib/reply-segments.mjs');
  assert.deepEqual(replySegments(msg.text, msg.permissions).map((part) => part.kind === 'text' ? part.text : part.request.status), ['I checked the files.\n\n', 'allowed', 'Now the checks passed.']);
});
