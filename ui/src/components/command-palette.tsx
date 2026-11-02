import { FolderPlus, GitCompareArrows, ListTodo, MessageSquare, Plug, Settings, Sparkles, SquarePen, SunMoon } from 'lucide-react';
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
    <CommandDialog open={s.palette} onOpenChange={s.setPalette} title="Search and commands" description="Jump to a thread, switch agent or run a command">
      <CommandInput placeholder="Search threads, agents and commands…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem disabled={!s.project} onSelect={run(() => s.newThread())}><SquarePen /> New thread<CommandShortcut>Ctrl N</CommandShortcut></CommandItem>
          {s.git && <CommandItem onSelect={run(() => s.openReview(null))}><GitCompareArrows /> Review changes</CommandItem>}
          {s.hub.platform !== 'vscode' && <CommandItem onSelect={run(async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } })}><FolderPlus /> Add project folder</CommandItem>}
          <CommandItem onSelect={run(() => s.openSettings('mcp'))}><Plug /> MCP servers</CommandItem>
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
