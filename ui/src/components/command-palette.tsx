import * as React from 'react';
import { defaultFilter } from 'cmdk';
import { toast } from 'sonner';
import { ShortcutLabel } from '@/components/shortcut-settings';
import type { ShortcutAction } from '../../../core/shortcuts.mjs';
import { BookOpen, Bug, Download, Maximize, Scan, FileImage, FolderPlus, Globe, Keyboard, GitCompareArrows, ListTodo, MessageSquare, Plug, Settings, Sparkles, SquarePen, SquareTerminal, SunMoon, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { AgentAvatar } from '@/components/agent-avatar';
import { SearchLabel } from '@/components/search-label';
import { ago } from '@/lib/format';
import { useStore } from '@/store';
import { useFullscreen } from '@/hooks/use-fullscreen';

const historyKey = 'tributary.recentCommands.v1';
function readHistory(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(historyKey) || '[]'); return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length < 80))].slice(0, 6) : []; }
  catch { return []; }
}
type Action = { id: string; label: string; icon: LucideIcon; run: () => unknown; shortcut?: ShortcutAction; keywords?: string[]; disabled?: boolean };

export function CommandPalette() {
  const s = useStore(); const fullscreen = useFullscreen();
  const [recent, setRecent] = React.useState(readHistory);
  const [query, setQuery] = React.useState('>');
  const labelQuery = query.replace(/^\s*>\s*/, '');
  React.useEffect(() => { if (s.palette) setQuery('>'); }, [s.palette]);
  const close = () => s.setPalette(false);
  const splitEditor = (direction = 'horizontal') => { s.openPanel('files'); requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('tributary:split-editor', { detail: direction })))); };
  const run = (fn: () => unknown) => () => { close(); void Promise.resolve().then(fn).catch((error: Error) => toast.error(error.message || 'Could not run command')); };
  const actions: Action[] = [
    { id: 'find-file', label: 'File: Quick Open', icon: FileImage, shortcut: 'find-file', keywords: ['find', 'search', 'filename'], disabled: !s.project, run: () => window.dispatchEvent(new Event('tributary:quick-open')) },
    { id: 'search-project', label: 'Search: Find in Files', icon: FileImage, shortcut: 'search-project', keywords: ['grep', 'text', 'project'], disabled: !s.project, run: () => window.dispatchEvent(new Event('tributary:search-project')) },
    { id: 'focus', label: s.workspaceExpanded ? 'View: Restore Layout' : 'View: Focus Workspace', icon: Scan, shortcut: 'zoom-workspace', keywords: ['zoom', 'expand', 'zen', 'editor'], disabled: !s.project, run: () => { s.setWorkspaceExpanded(!s.panel.open || !s.workspaceExpanded); s.openPanel(s.panel.tab); } },
    ...(fullscreen.supported ? [{ id: 'fullscreen', label: fullscreen.active ? 'View: Exit Full Screen' : 'View: Full Screen', icon: Maximize, shortcut: 'fullscreen' as const, run: () => fullscreen.toggle() }] : []),
    { id: 'recent', label: 'File: Open Recent', icon: FolderPlus, shortcut: 'recent', keywords: ['folders', 'workspaces'], run: () => s.setRecentOpen(true) },
    { id: 'room', label: 'Team: Open Project Room', icon: Users, shortcut: 'room', keywords: ['host', 'join', 'LAN', 'invite', 'teammates'], run: () => s.setRoomOpen(true) },
    { id: 'activity', label: 'Agents: Show Live Activity', icon: ListTodo, shortcut: 'activity', keywords: ['background', 'workers', 'running'], run: () => window.dispatchEvent(new Event('tributary:live')) },
    { id: 'help', label: 'Preferences: Keyboard Shortcuts', icon: Keyboard, shortcut: 'help', run: () => s.setShortcutsOpen(true) },
    { id: 'new', label: 'Chat: New Chat', icon: SquarePen, shortcut: 'new', disabled: !s.project, run: () => s.newThread() },
    { id: 'files', label: 'View: Show Explorer', icon: FileImage, shortcut: 'files', keywords: ['files', 'images', 'preview'], disabled: !s.project, run: () => { s.setSearchFilesOpen(false); s.openPanel('files'); } },
    { id: 'split-editor', label: 'View: Split Editor Right', icon: FileImage, shortcut: 'split-editor', disabled: !s.project, run: () => splitEditor() },
    { id: 'split-editor-down', label: 'View: Split Editor Down', icon: FileImage, disabled: !s.project, run: () => splitEditor('vertical') },
    { id: 'memory', label: 'Project: Open Memory', icon: BookOpen, shortcut: 'memory', disabled: !s.project, run: () => s.openPanel('memory') },
    { id: 'preview', label: 'View: Open App Preview', icon: Globe, shortcut: 'preview', disabled: !s.project, run: () => s.openPanel('preview') },
    { id: 'tests', label: 'Testing: Show Test Results and QA', icon: Bug, keywords: ['Playwright', 'report', 'failure', 'trace', 'bug'], disabled: !s.project, run: () => s.openPanel('tests') },
    { id: 'checks', label: 'Tasks: Problems and Project Checks', icon: ListTodo, keywords: ['lint', 'eslint', 'typecheck', 'format', 'clippy', 'ruff', 'vet', 'test', 'diagnostics'], disabled: !s.project, run: s.openChecks },
    { id: 'debug', label: 'Debug: Open Debugger', icon: Bug, shortcut: 'debug', disabled: !s.project, run: () => s.setDebugOpen(true) },
    { id: 'terminal', label: 'Terminal: Show Terminal', icon: SquareTerminal, shortcut: 'terminal', disabled: !s.project, run: () => s.setTerminalOpen(true) },
    { id: 'team', label: 'Agents: Start Agent Team', icon: Users, shortcut: 'team', disabled: !s.project, run: () => s.setTeamOpen(true) },
    ...(s.git ? [{ id: 'changes', label: 'Git: Review Changes', icon: GitCompareArrows, shortcut: 'changes' as const, run: () => s.openReview(null) }] : []),
    ...(s.hub.platform !== 'vscode' ? [{ id: 'folder', label: 'File: Add Project Folder', icon: FolderPlus, run: async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } } }] : []),
    { id: 'mcp', label: 'Preferences: MCP Servers', icon: Plug, run: () => s.openSettings('mcp') },
    { id: 'connections', label: 'Preferences: Apps and Connections', icon: Plug, run: () => s.openSettings('connections') },
    { id: 'skills', label: 'Preferences: Skills', icon: Sparkles, run: () => s.openSettings('skills') },
    { id: 'gateways', label: 'Preferences: Model Gateways', icon: ListTodo, run: () => s.openSettings('gateways') },
    ...(s.hub.platform !== 'vscode' ? [{ id: 'theme', label: 'Preferences: Toggle Light / Dark Theme', icon: SunMoon, run: () => s.setTheme(s.theme === 'dark' ? 'light' : 'dark') }] : []),
    { id: 'settings', label: 'Preferences: Open Settings', icon: Settings, shortcut: 'settings', run: () => s.openSettings('appearance') },
    ...(s.hub.platform === 'desktop' ? [{ id: 'updates', label: 'Help: Check for App Updates', icon: Download, keywords: ['download', 'version', 'upgrade', 'release'], run: () => s.openSettings('about') }] : []),
  ];
  const recentActions = recent.map((id) => actions.find((action) => action.id === id)).filter((action): action is Action => !!action && !action.disabled);
  const choose = (action: Action) => run(() => {
    const next = [action.id, ...recent.filter((id) => id !== action.id)].slice(0, 6);
    setRecent(next); try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch { /* optional history */ }
    return action.run();
  });
  const row = (action: Action, section?: string) => <CommandItem key={action.id} value={action.label} keywords={action.keywords} disabled={action.disabled} onSelect={choose(action)}><span className="min-w-0 flex-1 truncate"><SearchLabel text={action.label} query={labelQuery} /></span>{action.shortcut && <CommandShortcut><ShortcutLabel action={action.shortcut} /></CommandShortcut>}{section && <span className="command-section-label">{section}</span>}</CommandItem>;
  const threads = (s.st?.projects ?? []).flatMap((p) => (s.threadsBy[p.path] || []).map((t) => ({ ...t, project: p })));
  return <CommandDialog open={s.palette} onOpenChange={s.setPalette} title="Command palette" description="Search commands, agents and chats. Use arrow keys to choose and Enter to run." className="feature-finder command-picker" commandProps={{ filter: (value, query, keywords) => defaultFilter(value, query.replace(/^\s*>\s*/, ''), keywords) }}>
    <div className="flex items-center gap-1 pr-1"><CommandInput className="pr-2" leading={<></>} value={query} onValueChange={setQuery} placeholder="Type a command or search chats…" aria-label="Search commands and chats" /><button aria-label="Close command palette" onClick={close} className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground max-sm:size-11 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button></div>
    <CommandList>
      <CommandEmpty>No matching commands or chats.</CommandEmpty>
      {!!recentActions.length && <CommandGroup aria-label="Recently used">{recentActions.map((action) => row(action, 'recently used'))}</CommandGroup>}
      <CommandGroup aria-label="Other commands">{actions.filter((action) => !recentActions.includes(action)).map((action) => row(action, recentActions.length ? 'other commands' : undefined))}</CommandGroup>
      {!!s.ready.length && <><CommandSeparator /><CommandGroup heading="Switch agent">{s.ready.map((a) => <CommandItem key={a.id} value={`agent ${a.name}`} onSelect={run(() => s.setAgentId(a.id))}><AgentAvatar agent={a} size="xs" /><span className="truncate"><SearchLabel text={a.name} query={labelQuery} /></span></CommandItem>)}</CommandGroup></>}
      {!!threads.length && <><CommandSeparator /><CommandGroup heading="Chats">{threads.slice(0, 200).map((t) => <CommandItem key={t.id} value={`${t.title} ${t.project.name} ${t.id}`} onSelect={run(() => s.openThread(t.id))}><MessageSquare /><span className="min-w-0 flex-1 truncate"><SearchLabel text={t.title} query={labelQuery} /></span><span className="max-w-40 truncate text-xs text-muted-foreground"><SearchLabel text={t.project.name} query={labelQuery} /> · {ago(t.updatedAt)}</span></CommandItem>)}</CommandGroup></>}
    </CommandList>
    <div className="sr-only"><span>↑ ↓ to navigate · Enter to run</span><span>Esc to close</span></div>
  </CommandDialog>;
}
