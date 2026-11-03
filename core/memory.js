'use strict';
// Shared project memory that every agent reads through AGENTS.md:
//   .tributary/memory.md   facts and decisions worth keeping (people and agents add to it)
//   .tributary/worklog.md  one line per turn, written by Tributary: who did what, which files changed
const fs = require('fs');
const path = require('path');
const state = require('./memory-state');

const DIR = '.tributary';
const MEMORY = path.join(DIR, 'memory.md');
const WORKLOG = path.join(DIR, 'worklog.md');
const POINTER_MARK = '<!-- tributary:memory -->';
const POINTER = `${POINTER_MARK}
## Shared memory
Several coding agents work in this project through Tributary. Before you start:
- Read \`.tributary/memory.md\` for project facts and decisions.
- Skim the end of \`.tributary/worklog.md\` to see what other agents did recently.
When you learn something a future agent needs (a decision, a gotcha, how to run something), add one short bullet to \`.tributary/memory.md\`.
`;
const MEMORY_TEMPLATE = `# Project memory

Facts and decisions every agent should know. Keep each item to one line.

## Decisions

## How to run and test

## Gotchas
`;

function enableMemory(project) {
  return state.locked(project, () => {
  for (const rel of [DIR, MEMORY, WORKLOG, 'AGENTS.md']) state.location(project, rel);
  state.ignorePrivateFiles(project);
  const created = [];
  fs.mkdirSync(path.join(project, DIR), { recursive: true });
  if (!fs.existsSync(path.join(project, MEMORY))) { fs.writeFileSync(path.join(project, MEMORY), MEMORY_TEMPLATE); created.push(MEMORY); }
  if (!fs.existsSync(path.join(project, WORKLOG))) { fs.writeFileSync(path.join(project, WORKLOG), '# Work log\n\nWritten by Tributary after each agent turn.\n\n'); created.push(WORKLOG); }
  const agentsMd = path.join(project, 'AGENTS.md');
  const cur = fs.existsSync(agentsMd) ? fs.readFileSync(agentsMd, 'utf8') : '# Project instructions\n\nShared by every coding agent.\n';
  if (!cur.includes(POINTER_MARK)) { fs.writeFileSync(agentsMd, `${cur.replace(/\s*$/, '\n')}\n${POINTER}`); created.push('AGENTS.md'); }
  return created;
  });
}
const enabled = (project) => fs.existsSync(state.location(project, MEMORY));

function readMemory(project) {
  const log = state.read(project, WORKLOG, { tail: true, max: 65536 }); const memory = state.read(project, MEMORY);
  return { enabled: enabled(project), memory, revision: state.revision(memory), context: state.settings(project), bytes: Buffer.byteLength(memory || ''), worklog: log ? log.split('\n').filter((l) => l.startsWith('- ')).slice(-60) : [] };
}
function saveMemory(project, text, expected) { return state.save(project, text, expected); }
function remember(project, note) {
  const line = String(note).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!line) throw new Error('Nothing to remember');
  if (!enabled(project)) enableMemory(project);
  const current = state.read(project, MEMORY) || '';
  state.save(project, `${current}- ${line}\n`, state.revision(current));
  return line;
}
function logTurn(project, { agentName, request, files, ok, when = new Date() }) {
  if (!enabled(project)) return false;
  state.location(project, WORKLOG);
  const stamp = when.toISOString().slice(0, 16).replace('T', ' ');
  const req = String(request || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const changed = (files || []).slice(0, 12).map((f) => `\`${f}\``).join(', ') + ((files || []).length > 12 ? ` and ${files.length - 12} more` : '');
  fs.appendFileSync(path.join(project, WORKLOG), `- ${stamp} ${agentName}${ok ? '' : ' (failed)'}: "${req}"${changed ? `. Changed ${changed}` : ''}\n`);
  return true;
}

module.exports = { enableMemory, readMemory, saveMemory, remember, logTurn, enabled, MEMORY, WORKLOG };
