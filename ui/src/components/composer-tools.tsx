import * as React from 'react';
import { ArrowLeft, BookOpen, ChevronRight, FolderOpen, Keyboard, ListTodo, Plug, Plus, Search, Settings2, Sparkles, SquareTerminal, Users, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { AgentAvatar } from '@/components/agent-avatar';
import { FileTypeIcon } from '@/components/file-type-icon';
import { useStore } from '@/store';
import type { UiSkill } from '@/types';

type Page = 'main' | 'files' | 'skills' | 'agents' | 'mcp';
type Skill = { name: string; title: string; description: string; agents: string[] };
type Mcp = { name: string; agent: string; enabled: boolean };
const TITLES: Record<Page, string> = { main: 'Tools and skills', files: 'Project files', skills: 'Skills', agents: 'Your agents', mcp: 'MCP tools' };

/** Discover existing capabilities; choosing context only prepares the next message. */
export function ComposerTools({ everyday, planOn, setPlanOn, focusMessage, onAttach }: { everyday: boolean; planOn: boolean; setPlanOn: (value: boolean) => void; focusMessage: () => void; onAttach?: () => void }) {
  const s = useStore(); const [open, setOpen] = React.useState(false); const [page, setPage] = React.useState<Page>('main');
  const [query, setQuery] = React.useState(''); const [width, setWidth] = React.useState(360);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(''); const [retry, setRetry] = React.useState(0);
  const [files, setFiles] = React.useState<string[]>([]); const [skills, setSkills] = React.useState<Skill[]>([]);
  const [guides, setGuides] = React.useState<UiSkill[]>([]); const [servers, setServers] = React.useState<Mcp[]>([]);
  const [using, setUsing] = React.useState(false); const trigger = React.useRef<HTMLButtonElement>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const context = React.useRef(s.workdir); context.current = s.workdir;
  const inserting = React.useRef(false);
  const changePage = (next: Page) => { setPage(next); setQuery(''); setError(''); };
  const changeOpen = (value: boolean) => { setOpen(value); if (value) changePage('main'); };
  const run = (action: () => void) => { setOpen(false); requestAnimationFrame(action); };
  const insert = (text: string, prepend = false) => {
    s.setDraft((draft) => prepend ? `${text}\n\n${draft}` : `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text} `);
    inserting.current = true; setOpen(false);
  };
  React.useEffect(() => { setOpen(false); }, [s.project, s.workdir, s.agentId]);
  React.useEffect(() => { if (open) requestAnimationFrame(() => searchInput.current?.focus()); }, [open, page]);
  React.useEffect(() => {
    if (!open) return;
    const composer = trigger.current?.closest('[data-slot="input-group"]'); if (!composer) return;
    const resize = () => setWidth(Math.min(620, Math.max(280, composer.getBoundingClientRect().width)));
    resize(); const observer = new ResizeObserver(resize); observer.observe(composer); return () => observer.disconnect();
  }, [open]);
  React.useEffect(() => {
    if (!open || !['files', 'skills', 'mcp'].includes(page)) return;
    let alive = true; setBusy(true); setError('');
    if (page === 'files') setFiles([]);
    if (page === 'mcp') setServers([]);
    if (page === 'skills') { setSkills([]); setGuides([]); }
    const load = async () => {
      try {
        if (page === 'files') { const list = await s.hub.call<string[]>('listFiles', s.workdir); if (alive) setFiles(list); }
        if (page === 'mcp') { const list = await s.hub.call<Mcp[]>('mcp', s.project); if (alive) setServers(list); }
        if (page === 'skills') {
          const [builtIn, installed] = await Promise.allSettled([s.hub.call<UiSkill[]>('uiSkills'), s.hub.call<Skill[]>('skills', s.project)]);
          if (alive) {
            setGuides(builtIn.status === 'fulfilled' ? builtIn.value : []); setSkills(installed.status === 'fulfilled' ? installed.value : []);
            if (builtIn.status === 'rejected' || installed.status === 'rejected') setError('Some skills could not be loaded.');
          }
        }
      } catch { if (alive) { setError('Could not load this list.'); setFiles([]); setServers([]); } }
      finally { if (alive) setBusy(false); }
    };
    void load(); return () => { alive = false; };
  }, [open, page, retry, s.project, s.workdir, s.hub]);
  const useGuide = async (id: string) => {
    if (using) return; const project = s.workdir; setUsing(true); setError('');
    try { const guide = await s.hub.call<UiSkill>('uiSkill', id); if (!guide.instructions) throw new Error(); if (context.current === project) insert(guide.instructions, true); }
    catch { setError('Could not add this skill. Try again.'); } finally { setUsing(false); }
  };
  const row = (key: string, label: string, icon: React.ReactNode, description: string, action: () => void, options?: { disabled?: boolean; checked?: boolean; next?: boolean; keywords?: string }) => <CommandItem key={key} value={key} keywords={[label, description, options?.keywords ?? '']} onSelect={action} disabled={options?.disabled} data-checked={options?.checked} className="composer-tool-item min-h-9 gap-2 rounded-lg py-1.5 text-[13px] max-sm:min-h-11">
    {icon}<span className="min-w-0 flex-1 truncate">{label}</span><span className="max-w-[48%] truncate text-xs text-muted-foreground max-sm:hidden">{description}</span>{options?.next && <ChevronRight className="size-3.5 text-muted-foreground" />}
  </CommandItem>;
  const shownFiles = files.filter((file) => !query || file.toLowerCase().includes(query.toLowerCase()));
  const availableSkills = skills.filter((skill) => skill.agents.includes(s.agent.id));
  const connectionAgents = s.ready.filter((agent) => !!agent.connectionId);
  const names = [...new Set(servers.map((server) => server.name))];
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><InputGroupButton ref={trigger} size="icon-sm" aria-label="Tools and planning" title="Tools and skills" className="rounded-full"><Plus className="size-4" /></InputGroupButton></PopoverTrigger>
    <PopoverContent aria-label="Tools and skills" align="start" alignOffset={-8} side="top" sideOffset={8} collisionPadding={8} style={{ width }} className="composer-tools max-w-[calc(100vw-16px)] gap-0 overflow-hidden rounded-xl p-0 shadow-lg" onCloseAutoFocus={(event) => { if (inserting.current) { event.preventDefault(); inserting.current = false; requestAnimationFrame(focusMessage); } }}>
      <Command key={page} shouldFilter={page !== 'files'} className="rounded-xl p-1" aria-label={TITLES[page]}>
        <div className="flex h-9 shrink-0 items-center gap-2 px-2 text-xs text-muted-foreground max-sm:h-11">
          {page !== 'main' && <Button size="icon-sm" variant="ghost" className="max-sm:size-11" aria-label="Back to tools" onClick={() => changePage('main')}><ArrowLeft /></Button>}
          <span className="min-w-0 flex-1 truncate font-medium">{TITLES[page]}</span>{(busy || using) && <Spinner aria-label="Loading" className="size-3.5" />}
        </div>
        <CommandInput ref={searchInput} aria-label="Search tools and skills" value={query} onValueChange={setQuery} placeholder={page === 'files' ? 'Find a project file…' : `Search ${TITLES[page].toLowerCase()}…`} />
        {error && <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs"><span className="min-w-0 flex-1">{error}</span><Button variant="ghost" size="xs" className="max-sm:min-h-11" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>}
        <CommandList aria-label={TITLES[page]} aria-busy={busy || using} className="max-h-[min(360px,45dvh)] py-1">
          <CommandEmpty>{busy ? 'Loading…' : 'No matches.'}</CommandEmpty>
          {page === 'main' && <>
            <CommandGroup>
              {onAttach && row('attach', 'Attach files or images', <Paperclip />, 'Paste or drop files', () => run(onAttach))}
              {row('files', 'Files and folders', <FolderOpen />, everyday ? 'Browse your project' : 'Reference project files', () => changePage('files'), { disabled: !s.project, next: true, keywords: 'reference context' })}
              {row('skills', 'Skills', <Sparkles />, 'Guidance for your next message', () => changePage('skills'), { next: true })}
              {!everyday && row('plan', 'Plan first', <ListTodo />, 'Review a plan before building', () => run(() => { setPlanOn(!planOn); focusMessage(); }), { checked: planOn })}
              {!everyday && row('team', 'Work with a team', <Users />, 'Delegate coding tasks', () => run(() => s.setTeamOpen(true)))}
              {!everyday && row('delegation', 'Agent delegation', <Users />, s.st?.settings.agentDelegation === false ? 'Off' : `Up to ${Number(s.st?.settings.delegationConcurrency) || 2} background workers`, () => run(() => { void s.hub.call('setSettings', { agentDelegation: s.st?.settings.agentDelegation === false }).catch((error: Error) => setError(error.message)); }), { checked: s.st?.settings.agentDelegation !== false })}
              {row('agents', 'Your agents', <Users />, 'Switch or add an assistant', () => changePage('agents'), { next: true })}
              {row('connections', 'Apps and connections', <Plug />, 'Manage assistant connections', () => run(() => s.openSettings('connections')))}
              {!everyday && row('mcp', 'MCP tools', <Plug />, 'Configured agent tool servers', () => changePage('mcp'), { next: true })}
            </CommandGroup>
            {connectionAgents.length > 0 && <><CommandSeparator /><CommandGroup heading="Connected assistants">{connectionAgents.map((agent) => row(`connection:${agent.id}`, agent.name, <AgentAvatar agent={agent} size="xs" />, 'Switch assistant', () => run(() => { s.setGatewayId(''); s.setAgentId(agent.id); })) )}</CommandGroup></>}
            <CommandSeparator /><CommandGroup>
              {row('memory', 'Project memory', <BookOpen />, 'Notes shared across agents', () => run(() => s.openPanel('memory')), { disabled: !s.project })}
              {!everyday && row('terminal', 'Terminal', <SquareTerminal />, 'Open the project terminal', () => run(() => s.setTerminalOpen(true)), { disabled: !s.project })}
              {row('shortcuts', 'Keyboard shortcuts', <Keyboard />, 'See available shortcuts', () => run(() => s.setShortcutsOpen(true)))}
              {row('features', 'All features', <Search />, 'Find tools and workspace actions', () => run(() => s.setPalette(true)))}
            </CommandGroup>
          </>}
          {page === 'files' && <CommandGroup>
            {shownFiles.slice(0, 80).map((file) => row(`file:${file}`, file, <FileTypeIcon path={file} />, everyday ? 'Open file' : 'Add to message', () => everyday ? run(() => s.openFile(file)) : insert(`@${/\s/.test(file) ? JSON.stringify(file) : file}`)))}
            {!busy && shownFiles.length === 0 && <p role="status" className="px-3 py-3 text-xs text-muted-foreground">No project files match.</p>}
            {shownFiles.length > 80 && <p className="px-3 py-2 text-xs text-muted-foreground">Type more to narrow {shownFiles.length.toLocaleString()} files.</p>}
            {row('browse', 'Browse files', <FolderOpen />, 'Open the explorer', () => run(() => s.openPanel('files')))}
          </CommandGroup>}
          {page === 'skills' && <>
            <CommandGroup heading="Included guidance">{guides.map((guide) => row(`guide:${guide.id}`, guide.title, <Sparkles />, 'Add full guidance', () => { void useGuide(guide.id); }, { disabled: using, keywords: guide.description }))}</CommandGroup>
            {!everyday && <CommandGroup heading={`Available to ${s.agent.name}`}>{availableSkills.map((skill) => row(`skill:${skill.name}`, skill.title || skill.name, <Sparkles />, skill.description, () => insert(`Use the ${skill.name} skill.`)))}</CommandGroup>}
            <CommandSeparator /><CommandGroup>{row('manage-skills', 'Manage skills', <Settings2 />, 'Browse all installed skills', () => run(() => s.openSettings('skills')))}</CommandGroup>
          </>}
          {page === 'agents' && <CommandGroup>
            {s.ready.map((agent) => row(`agent:${agent.id}`, agent.name, <AgentAvatar agent={agent} size="xs" />, agent.connectionId ? 'Assistant connection' : 'Coding agent', () => run(() => { s.setGatewayId(''); s.setAgentId(agent.id); }), { checked: s.agentId === agent.id }))}
            {row('add-agent', 'Add an assistant', <Plus />, 'Connect a model or agent', () => run(() => s.openSettings('connections')))}
            {row('custom-agent', 'Manage coding agents', <Settings2 />, 'Installed and custom agents', () => run(() => s.openSettings('agents')))}
          </CommandGroup>}
          {page === 'mcp' && <CommandGroup>
            {names.map((name) => { const configured = servers.some((server) => server.name === name && server.agent === s.agent.id && server.enabled); return row(`mcp:${name}`, name, <Plug />, configured ? 'Add to message' : 'Manage configuration', () => configured ? insert(`Use the ${name} MCP tools for this task.`) : run(() => s.openSettings('mcp'))); })}
            {row('manage-mcp', 'Manage MCP servers', <Settings2 />, 'Add or configure tool servers', () => run(() => s.openSettings('mcp')))}
            {!busy && names.length === 0 && <p role="status" className="px-3 py-3 text-xs text-muted-foreground">No tool servers configured.</p>}
          </CommandGroup>}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
