import { ShortcutLabel } from '@/components/shortcut-settings';
import { BookOpen, FileImage, FolderPlus, Globe, Keyboard, GitCompareArrows, ListTodo, MessageSquare, Plug, Settings, Sparkles, SquarePen, SquareTerminal, SunMoon, Users } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { AgentAvatar } from '@/components/agent-avatar';
import { ago } from '@/lib/format';
import { useStore } from '@/store';

export function CommandPalette() {
  const s = useStore();
  const close = () => s.setPalette(false);
  const run = (fn: () => void) => () => { close(); fn(); };
  const threads = (s.st?.projects ?? []).flatMap((p) => (s.threadsBy[p.path] || []).map((t) => ({ ...t, project: p })));
  return (
    <CommandDialog open={s.palette} onOpenChange={s.setPalette} title="Search and features" description="Find tools, workspace actions, agents and chats." className="feature-finder top-1/2 max-h-[calc(100dvh-32px)] -translate-y-1/2 max-sm:[&_[cmdk-item]]:min-h-11 max-sm:[&_[cmdk-input]]:min-h-11 max-sm:[&_[data-slot=input-group]]:min-h-11">
      <CommandInput placeholder="Search features, agents and chats…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem keywords={['recent', 'files', 'folders', 'workspaces']} onSelect={run(() => s.setRecentOpen(true))}><FolderPlus />Open recent files and folders</CommandItem>
          <CommandItem keywords={['host', 'join', 'LAN', 'invite', 'teammates']} onSelect={run(() => s.setRoomOpen(true))}><Users /> Project room</CommandItem>
          <CommandItem keywords={['background', 'workers', 'running']} onSelect={run(() => window.dispatchEvent(new Event('tributary:live')))}><ListTodo /> Live activity</CommandItem>
          <CommandItem onSelect={run(() => s.setShortcutsOpen(true))}><Keyboard /> Keyboard shortcuts<CommandShortcut><ShortcutLabel action="help" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.newThread())}><SquarePen /> New chat<CommandShortcut><ShortcutLabel action="new" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('files'))}><FileImage /> Files and image previews</CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('memory'))}><BookOpen /> Project memory</CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('preview'))}><Globe /> App preview</CommandItem>
          <CommandItem disabled={!s.project} keywords={['lint', 'eslint', 'typecheck', 'format', 'clippy', 'ruff', 'vet', 'test', 'diagnostics']} onSelect={run(s.openChecks)}><ListTodo /> Problems and project checks</CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.setTerminalOpen(true))}><SquareTerminal /> Terminal</CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.setTeamOpen(true))}><Users /> Agent teams · Parallel and background runs</CommandItem>
          {s.git && <CommandItem onSelect={run(() => s.openReview(null))}><GitCompareArrows /> Review changes</CommandItem>}
          {s.hub.platform !== 'vscode' && <CommandItem onSelect={run(async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } })}><FolderPlus /> Add project folder</CommandItem>}
          <CommandItem onSelect={run(() => s.openSettings('mcp'))}><Plug /> MCP servers</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('connections'))}><Plug /> Apps and connections</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('skills'))}><Sparkles /> Skills</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('gateways'))}><ListTodo /> Model gateways</CommandItem>
          {s.hub.platform !== 'vscode' && <CommandItem onSelect={run(() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark'))}><SunMoon /> Toggle light and dark</CommandItem>}
          <CommandItem onSelect={run(() => s.openSettings('agents'))}><Settings /> Settings</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Switch agent">
          {s.ready.map((a) => <CommandItem key={a.id} value={`agent ${a.name}`} onSelect={run(() => s.setAgentId(a.id))}><AgentAvatar agent={a} size="xs" /> {a.name}</CommandItem>)}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Threads">
          {threads.slice(0, 200).map((t) => (
            <CommandItem key={t.id} value={`${t.title} ${t.project.name} ${t.id}`} onSelect={run(() => s.openThread(t.id))}>
              <MessageSquare /> <span className="truncate">{t.title}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.project.name}, {ago(t.updatedAt)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
