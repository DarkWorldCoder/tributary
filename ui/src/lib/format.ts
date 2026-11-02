import type { Agent, AgentMessage, Tool } from '@/types';

export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`; return new Date(t).toLocaleDateString();
};
export const duration = (ms?: number) => {
  if (!ms) return '';
  if (ms < 1000) return `${ms} ms`; if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};
export const relTo = (project: string | null, p?: string) => (project && p && p.startsWith(`${project}/`) ? p.slice(project.length + 1) : p || '');
export function toolTarget(t: Tool, project: string | null): string {
  const i = (t.input || {}) as Record<string, any>;
  const v = i.command ?? i.cmd ?? i.file_path ?? i.filePath ?? i.path ?? i.Path ?? i.pattern ?? i.query ?? i.url ?? i.description ?? (Array.isArray(i.changes) ? i.changes.map((c: any) => c.path).join(', ') : undefined);
  if (v != null) return Array.isArray(v) ? v.join(' ') : relTo(project, String(v));
  const s = JSON.stringify(i); return s && s !== '{}' ? s.slice(0, 160) : '';
}
const CMD = /^(shell|bash|run_shell_command|exec|terminal)$/i;
const EDIT = /edit|write|replace|patch|create/i;
const READ = /^(read|read_file|read_many_files|view|cat|open)$/i;
const SEARCH = /grep|glob|search|find|ls|list/i;
export function toolVerb(t: Tool): string {
  if (CMD.test(t.name)) return 'Ran'; if (EDIT.test(t.name)) return 'Edited'; if (READ.test(t.name)) return 'Read';
  if (SEARCH.test(t.name)) return 'Searched'; if (/web/i.test(t.name)) return 'Browsed'; return t.name;
}
export function activitySummary(m: AgentMessage): string {
  const tools = m.tools || [];
  const cmds = tools.filter((t) => CMD.test(t.name)).length;
  const files = (m.files || []).filter((f) => !f.external).length;
  const reads = tools.filter((t) => READ.test(t.name) || SEARCH.test(t.name)).length;
  const parts: string[] = [];
  if (m.durationMs) parts.push(`Worked for ${duration(m.durationMs)}`);
  const acts: string[] = [];
  if (reads) acts.push(`looked at ${reads} file${reads > 1 ? 's' : ''}`);
  if (cmds) acts.push(`ran ${cmds} command${cmds > 1 ? 's' : ''}`);
  if (files) acts.push(`changed ${files} file${files > 1 ? 's' : ''}`);
  if (!acts.length && tools.length) acts.push(`${tools.length} step${tools.length > 1 ? 's' : ''}`);
  return [parts.join(''), acts.join(', ')].filter(Boolean).join(' and ');
}
export const changeCode = (c?: string) => {
  const s = String(c || 'M');
  if (['M', 'A', 'D', 'R'].includes(s)) return s; if (s === '??') return 'A';
  if (/add|create|new/i.test(s)) return 'A'; if (/delete|remove/i.test(s)) return 'D'; return 'M';
};
export const agentLabel = (a?: Agent) => a?.name ?? 'Agent';
export function langFromPath(p: string) {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  return ({ ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', py: 'python', json: 'json', css: 'css', html: 'html', md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'bash' } as Record<string, string>)[ext] || 'text';
}
