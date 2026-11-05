import { ShortcutLabel } from '@/components/shortcut-settings';
import { BookOpen, Bug, Download, Maximize, Scan, FileImage, FolderPlus, Globe, Keyboard, GitCompareArrows, ListTodo, MessageSquare, Plug, Settings, Sparkles, SquarePen, SquareTerminal, SunMoon, Users } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { AgentAvatar } from '@/components/agent-avatar';
import { ago } from '@/lib/format';
import { useStore } from '@/store';
import { useFullscreen } from '@/hooks/use-fullscreen';

export function CommandPalette() {
  const s = useStore(); const fullscreen = useFullscreen();
  const close = () => s.setPalette(false);
  const run = (fn: () => void) => () => { close(); fn(); };
  const threads = (s.st?.projects ?? []).flatMap((p) => (s.threadsBy[p.path] || []).map((t) => ({ ...t, project: p })));
  return (
    <CommandDialog open={s.palette} onOpenChange={s.setPalette} title="Command palette" description="Find tools, workspace actions, agents and chats." className="feature-finder top-11 max-h-[min(560px,calc(100dvh-64px))] -translate-y-0 gap-0 rounded-md! shadow-2xl sm:max-w-[600px] max-sm:[&_[cmdk-item]]:min-h-11 max-sm:[&_[cmdk-input]]:min-h-11 max-sm:[&_[data-slot=input-group]]:min-h-11">
      <CommandInput leading={<span aria-hidden="true" className="font-mono text-sm text-muted-foreground">&gt;</span>} placeholder="Type a command or search chats…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem disabled={!s.project} keywords={['grep', 'find', 'text', 'search']} onSelect={run(() => window.dispatchEvent(new Event('tributary:search-project')))}><FileImage />Search in project files<CommandShortcut><ShortcutLabel action="search-project" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} keywords={['zoom', 'expand', 'zen', 'editor', 'restore']} onSelect={run(() => { s.setWorkspaceExpanded(!s.panel.open || !s.workspaceExpanded); s.openPanel(s.panel.tab); })}><Scan />{s.workspaceExpanded ? 'Restore layout' : 'Focus workspace'}<CommandShortcut><ShortcutLabel action="zoom-workspace" /></CommandShortcut></CommandItem>
          {fullscreen.supported && <CommandItem keywords={['window', 'fullscreen', 'screen']} onSelect={run(() => void fullscreen.toggle())}><Maximize />{fullscreen.active ? 'Exit full screen' : 'Full screen'}<CommandShortcut><ShortcutLabel action="fullscreen" /></CommandShortcut></CommandItem>}
          <CommandItem keywords={['recent', 'files', 'folders', 'workspaces']} onSelect={run(() => s.setRecentOpen(true))}><FolderPlus />Open recent files and folders<CommandShortcut><ShortcutLabel action="recent" /></CommandShortcut></CommandItem>
          <CommandItem keywords={['host', 'join', 'LAN', 'invite', 'teammates']} onSelect={run(() => s.setRoomOpen(true))}><Users /> Project room<CommandShortcut><ShortcutLabel action="room" /></CommandShortcut></CommandItem>
          <CommandItem keywords={['background', 'workers', 'running']} onSelect={run(() => window.dispatchEvent(new Event('tributary:live')))}><ListTodo /> Live activity<CommandShortcut><ShortcutLabel action="activity" /></CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => s.setShortcutsOpen(true))}><Keyboard /> Keyboard shortcuts<CommandShortcut><ShortcutLabel action="help" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.newThread())}><SquarePen /> New chat<CommandShortcut><ShortcutLabel action="new" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('files'))}><FileImage /> Files and image previews<CommandShortcut><ShortcutLabel action="files" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('memory'))}><BookOpen /> Project memory<CommandShortcut><ShortcutLabel action="memory" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.openPanel('preview'))}><Globe /> App preview<CommandShortcut><ShortcutLabel action="preview" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} keywords={['QA', 'Playwright', 'report', 'failure', 'trace', 'bug', 'testing']} onSelect={run(() => s.openPanel('tests'))}><Bug /> Test results and QA</CommandItem>
          <CommandItem disabled={!s.project} keywords={['lint', 'eslint', 'typecheck', 'format', 'clippy', 'ruff', 'vet', 'test', 'diagnostics']} onSelect={run(s.openChecks)}><ListTodo /> Problems and project checks</CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.setDebugOpen(true))}><Bug /> Debugger<CommandShortcut><ShortcutLabel action="debug" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.setTerminalOpen(true))}><SquareTerminal /> Terminal<CommandShortcut><ShortcutLabel action="terminal" /></CommandShortcut></CommandItem>
          <CommandItem disabled={!s.project} onSelect={run(() => s.setTeamOpen(true))}><Users /> Agent teams<CommandShortcut><ShortcutLabel action="team" /></CommandShortcut></CommandItem>
          {s.git && <CommandItem onSelect={run(() => s.openReview(null))}><GitCompareArrows /> Review changes<CommandShortcut><ShortcutLabel action="changes" /></CommandShortcut></CommandItem>}
          {s.hub.platform !== 'vscode' && <CommandItem onSelect={run(async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } })}><FolderPlus /> Add project folder</CommandItem>}
          <CommandItem onSelect={run(() => s.openSettings('mcp'))}><Plug /> MCP servers</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('connections'))}><Plug /> Apps and connections</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('skills'))}><Sparkles /> Skills</CommandItem>
          <CommandItem onSelect={run(() => s.openSettings('gateways'))}><ListTodo /> Model gateways</CommandItem>
          {s.hub.platform !== 'vscode' && <CommandItem onSelect={run(() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark'))}><SunMoon /> Toggle light and dark</CommandItem>}
          <CommandItem onSelect={run(() => s.openSettings('agents'))}><Settings /> Settings<CommandShortcut><ShortcutLabel action="settings" /></CommandShortcut></CommandItem>
          {s.hub.platform === 'desktop' && <CommandItem keywords={['update', 'download', 'version', 'upgrade', 'release']} onSelect={run(() => s.openSettings('about'))}><Download /> Check for app updates</CommandItem>}
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
