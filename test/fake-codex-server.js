'use strict';
const { createInterface } = require('node:readline'); const rl = createInterface({ input: process.stdin });
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n'); const notify = (method, params) => out({ method, params });
let session = 'codex-native-fixture'; let prompt = ''; let images = 0; let approvalPolicy = ''; let resumed = false;
function finish(status = 'completed', decision = '') { const text = `Native ${decision}; images:${images}; policy:${approvalPolicy}; resumed:${resumed}; ${prompt}`; notify('item/agentMessage/delta', { threadId: session, itemId: 'answer', delta: text }); notify('item/completed', { threadId: session, item: { id: 'answer', type: 'agentMessage', text } }); notify('turn/completed', { threadId: session, turn: { id: 'turn', status } }); }
rl.on('line', (line) => {
 const m = JSON.parse(line); const p = m.params || {};
 if (m.method === 'initialize') out({ id: m.id, result: { userAgent: 'fixture' } });
 else if (m.method === 'thread/start' || m.method === 'thread/resume') { resumed = m.method === 'thread/resume'; session = p.threadId || session; approvalPolicy = p.approvalPolicy; out({ id: m.id, result: { thread: { id: session }, model: p.model || 'fixture' } }); }
 else if (m.method === 'turn/start') { prompt = p.input.find((i) => i.type === 'text').text; images = p.input.filter((i) => i.type === 'localImage').length; out({ id: m.id, result: { turn: { id: 'turn' } } }); notify('turn/started', { threadId: session, turn: { id: 'turn' } }); notify('turn/plan/updated', { threadId: session, plan: [{ step: 'Inspect project', status: 'inProgress' }] }); notify('item/started', { threadId: session, item: { id: 'shell', type: 'commandExecution', command: 'npm test', status: 'inProgress' } });
 if (prompt.includes('PERMISSIONS')) out({ id: 'ask', method: 'item/permissions/requestApproval', params: { threadId: session, itemId: 'access', reason: 'Access fixture output', permissions: { fileSystem: { write: ['/fixture/output'] }, network: { enabled: true } } } });
 else if (prompt.includes('QUESTION')) out({ id: 'ask', method: 'item/tool/requestUserInput', params: { threadId: session, itemId: 'question', questions: [{ id: 'db', question: 'Which database?', header: 'Database', options: [{ label: 'SQLite', description: 'Local' }] }] } });
 else out({ id: 'ask', method: prompt.includes('EDIT') ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval', params: { threadId: session, itemId: 'shell', command: 'npm test', reason: 'Run fixture check' } }); }
 else if (m.method === 'turn/interrupt') { out({ id: m.id, result: {} }); finish('interrupted'); }
 else if (m.id === 'ask' && m.result) { notify('item/commandExecution/outputDelta', { threadId: session, itemId: 'shell', delta: 'Fixture check output' }); notify('item/completed', { threadId: session, item: { id: 'shell', type: 'commandExecution', command: 'npm test', status: m.result.decision === 'decline' ? 'declined' : 'completed', aggregatedOutput: 'Fixture check output' } }); finish('completed', m.result.decision || JSON.stringify(m.result.answers || m.result.permissions)); }
});
rl.on('close', () => process.exit(0));
