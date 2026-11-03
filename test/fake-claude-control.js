'use strict';
const { createInterface } = require('node:readline');
const input = createInterface({ input: process.stdin }); const out = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let count = 0; let task = ''; let answers = [];
function ask() { count++; out({ type: 'control_request', request_id: `permission-${count}`, request: { subtype: 'can_use_tool', tool_name: task.includes('QUESTION') ? 'AskUserQuestion' : task.includes('EDIT') ? 'Write' : 'Bash', tool_use_id: `tool-${count}`, input: task.includes('QUESTION') ? { questions: [{ question: 'Which database?', multiSelect: false, options: [{ label: 'SQLite', description: 'Local storage' }, { label: 'Postgres', description: 'Server storage' }] }] } : task.includes('EDIT') ? { file_path: '/fixture/change.txt', content: 'change' } : { command: 'npm test' }, description: 'Run fixture tool' } }); if (task.includes('WITHDRAW')) setTimeout(() => { out({ type: 'control_cancel_request', request_id: `permission-${count}` }); finish('withdrawn'); }, 60); }
function finish(text) { out({ type: 'assistant', message: { id: 'reply', content: [{ type: 'text', text }] } }); out({ type: 'result', session_id: 'native-fixture-session', is_error: false }); }
input.on('line', (line) => {
 const value = JSON.parse(line);
 if (value.type === 'user') { task = value.message.content.find((b) => b.type === 'text').text; out({ type: 'system', subtype: 'init', session_id: 'native-fixture-session', model: 'fixture' }); out({ type: 'assistant', message: { id: 'plan', content: [{ type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [{ content: 'Check the project', status: 'in_progress' }] } }] } }); ask(); }
 else if (value.type === 'control_response') { answers.push(value.response.response.behavior + (value.response.response.updatedInput?.answers ? ':' + JSON.stringify(value.response.response.updatedInput.answers) : '')); if (task.includes('TWICE') && count < 2) ask(); else finish(answers.join(',') + ':' + task); }
 else if (value.type === 'control_request' && value.request.subtype === 'interrupt') { finish('interrupted'); }
});
input.on('close', () => process.exit(0));
