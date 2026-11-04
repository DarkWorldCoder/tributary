'use strict';
// Normalize protocol data, never shell-evaluate titles or streamed arguments.
// OpenCode supplies structured names/locations. Kimi also sends complete JSON
// arguments in running content blocks while the title carries the tool name.
const NAMES = new Map([
  ['shell', 'Bash'], ['bash', 'Bash'], ['exec', 'Bash'], ['terminal', 'Bash'],
  ['read', 'Read'], ['readfile', 'Read'], ['read_file', 'Read'],
  ['write', 'Write'], ['writefile', 'Write'], ['write_file', 'Write'],
  ['edit', 'Edit'], ['strreplacefile', 'Edit'], ['str_replace', 'Edit'],
  ['patch', 'apply_patch'], ['apply_patch', 'apply_patch'],
  ['grep', 'Grep'], ['glob', 'Glob'], ['search', 'Search'],
  ['webfetch', 'WebFetch'], ['searchweb', 'WebSearch'], ['fetchurl', 'WebFetch'],
  ['task', 'background_agent'], ['subagent', 'background_agent'], ['agent', 'background_agent'],
  ['settodo', 'TodoWrite'], ['todowrite', 'TodoWrite'],
]);
const KINDS = { execute: 'Bash', read: 'Read', edit: 'Edit', search: 'Search', fetch: 'WebFetch' };
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
function jsonInput(value) {
  if (typeof value !== 'string' || value.length > 1024 * 1024) return record(value);
  try { return record(JSON.parse(value)); } catch { return undefined; }
}
function normalizeAcpTool(previous = {}, update = {}) {
  const call = { ...previous, ...Object.fromEntries(Object.entries(update).filter(([, value]) => value != null)) };
  const titleName = /^([\w.-]+)(?::|$)/.exec(call.title || '')?.[1];
  const named = call.name || titleName;
  const canonical = NAMES.get(String(named).toLowerCase());
  const name = canonical || KINDS[call.kind] || call.name || call.title || call.kind || 'tool';
  let input = jsonInput(update.rawInput) || record(previous.rawInput);
  let argumentsContent = false;
  // A result can also be JSON. Only running content of a recognized tool is input.
  // Later complete snapshots replace earlier ones; incomplete JSON keeps the
  // previous input and stays hidden instead of appearing as command output.
  if (canonical && !call.name && update.rawInput == null && !['completed', 'failed'].includes(update.status)) {
    const text = (update.content || []).filter((part) => part.type === 'content' && part.content?.type === 'text').map((part) => part.content.text).join('');
    argumentsContent = text.trimStart().startsWith('{');
    const parsed = jsonInput(text); if (parsed) input = parsed;
  }
  if (input) call.rawInput = input;
  call.canonicalName = name;
  if (!call.kind) call.kind = name === 'Bash' ? 'execute' : /^(Edit|Write|apply_patch)$/.test(name) ? 'edit' : name === 'Read' ? 'read' : undefined;
  const files = call.kind === 'read' || call.kind === 'edit'
    ? [...new Set([...(call.locations || []).map((location) => location.path), ...(call.content || []).filter((part) => part.type === 'diff').map((part) => part.path)].filter((file) => typeof file === 'string' && file))]
    : [];
  return { call, name, input, files, argumentsContent };
}
module.exports = { normalizeAcpTool };
