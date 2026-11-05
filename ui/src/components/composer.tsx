import { QueuedMessages } from '@/components/queued-messages';
import { ChatReviewBar } from '@/components/chat-review-bar';
import { TaskModePicker, type TaskMode } from '@/components/task-mode-picker';
import { ShortcutLabel } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import * as React from 'react';
import { ArrowUp, Check, ChevronDown, Clock, Cpu, Eye, ListTodo, PanelRight, PencilLine, Plug, Settings2, Sparkles, Square, Users, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ModelPicker } from '@/components/model-picker';
import { AgentAvatar } from '@/components/agent-avatar';
import { FileTypeIcon } from '@/components/file-type-icon';
import { ComposerTools } from '@/components/composer-tools';
import { cn } from '@/lib/utils';
import { useDraft, useStore } from '@/store';
import { ChatAttachments } from '@/components/chat-attachments';
import { toast } from 'sonner';
import type { Attachment, FileContent, Mode } from '@/types';

export const MODES: Record<Mode, { label: string; help: string; icon: React.ReactNode }> = {
  read: { label: 'Read-only', help: 'Answers and plans. Never changes files.', icon: <Eye /> },
  edit: { label: 'Edit files', help: 'Edits files in this project. Shell commands follow each agent’s own approval rules.', icon: <PencilLine /> },
  full: { label: 'Full auto', help: 'Approves everything, including shell commands. Use in projects you trust.', icon: <Zap /> },
};

const COMMANDS = [
  { name: 'team', hint: 'Delegate to background coding agents', insert: '/team ' },
  { name: 'plan', hint: 'Plan first, then approve to run', insert: '/plan ' },
  { name: 'research', hint: 'Web research with a cited report, no file edits', insert: '/research ' },
  { name: 'review', hint: 'Review uncommitted changes, no edits', text: 'Review the uncommitted changes in this project (see `git diff` and new files). Point out bugs, risks and missing tests, most important first. Do not change any files.', mode: 'read' as Mode },
  { name: 'test', hint: 'Run the tests and fix failures', text: 'Run this project’s test suite. If anything fails, find the cause and fix it, then run the tests again.' },
  { name: 'commit', hint: 'Write a message and commit', text: 'Write a concise commit message for the uncommitted changes, then stage everything and commit.' },
  { name: 'init', hint: 'Write AGENTS.md for this project', text: 'Create or update AGENTS.md at the project root with how to build, run and test this project, the code style, and anything an agent should know before changing code.' },
];

type Suggest = { kind: 'file' | 'command' | 'skill'; key: string; label: string; hint?: string; apply: () => void };

function AgentPicker() {
  const s = useStore(); const [open, setOpen] = React.useState(false);
  const a = s.agent; const gws = (s.st?.gateways ?? []).filter((g) => !g.direct && (a.gateways ?? []).includes(g.protocol));
  const gw = gws.find((g) => g.id === s.gatewayId);
  const missing = (s.st?.agents ?? []).filter((x) => !(x.available && x.headless));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton size="sm" className="composer-selector rounded-full" title={s.agent.name} aria-label="Choose agent and model source">
          {s.ready.length ? <AgentAvatar agent={a} size="xs" className="composer-agent-mark" /> : null}
          <span className={cn("composer-selector-label max-w-40 truncate font-medium", s.codeLayout && s.ready.length > 0 && "hidden")}>{s.ready.length ? a.name : 'Connect an assistant'}</span>
          {gw && <span className={cn("composer-selector-label max-w-28 truncate text-muted-foreground", s.codeLayout && "hidden")}>via {gw.name}</span>}
          <ChevronDown className="composer-selector-chevron text-muted-foreground" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Find an agent or gateway…" />
          <CommandList className="max-h-96">
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Agents">
              {s.ready.map((x) => (
                <CommandItem key={x.id} value={`${x.name} ${x.vendor}`} onSelect={() => { s.setAgentId(x.id); s.setGatewayId(''); setOpen(false); }} className="gap-2.5">
                  <AgentAvatar agent={x} size="sm" />
                  <div className="min-w-0 flex-1"><div className="font-medium">{x.name}</div><div className="truncate text-xs text-muted-foreground">{[x.vendor, x.version].filter(Boolean).join(', ')}</div></div>
                  {x.id === s.agentId && <Check className="text-brand" />}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            {!a.connectionId && <CommandGroup heading={`Model source for ${a.name}`}>
              <CommandItem value="default model sign-in" onSelect={() => { s.setGatewayId(''); setOpen(false); }} className="gap-2.5">
                <Cpu /><div className="flex-1"><div>Default</div><div className="text-xs text-muted-foreground">The agent’s own sign-in and model</div></div>{!s.gatewayId && <Check className="text-brand" />}
              </CommandItem>
              {gws.map((g) => (
                <CommandItem key={g.id} value={`gateway ${g.name} ${g.model}`} onSelect={() => { s.setGatewayId(g.id); setOpen(false); }} className="gap-2.5">
                  <Plug /><div className="min-w-0 flex-1"><div>{g.name}</div><div className="truncate font-mono text-xs text-muted-foreground">{g.model || g.baseUrl || g.protocol}</div></div>{s.gatewayId === g.id && <Check className="text-brand" />}
                </CommandItem>
              ))}
              <CommandItem value="manage gateways settings" onSelect={() => { setOpen(false); s.openSettings('gateways'); }} className="gap-2.5 text-muted-foreground"><Settings2 /> Manage gateways…</CommandItem>
            </CommandGroup>}
            <CommandGroup heading="Connections"><CommandItem value="connect assistant" onSelect={() => { setOpen(false); s.openSettings('connections'); }}><Plug />Connect an assistant…</CommandItem></CommandGroup>
            {missing.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Not set up">
                  {missing.map((x) => (
                    <CommandItem key={x.id} value={`setup ${x.name}`} onSelect={() => { setOpen(false); s.openSettings('agents'); }} className="gap-2.5 text-muted-foreground">
                      <AgentAvatar agent={x} size="sm" muted /><div className="flex-1"><div>{x.name}</div><div className="text-xs">{x.available ? 'Needs agents.json setup' : 'Not installed'}</div></div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ModePicker({ readOnly = false }: { readOnly?: boolean }) {
  const s = useStore(); const m = MODES[readOnly ? 'read' : s.mode];
  return (
    <DropdownMenu>
      <Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
        <InputGroupButton disabled={readOnly} size="sm" className={cn("composer-selector rounded-full", s.codeLayout && "composer-selector-icon [&>span]:hidden [&>svg:last-child]:hidden")} title={readOnly ? 'Plan and research are read-only' : m.label} aria-label={`Permissions: ${m.label}`}>{m.icon}<span className="composer-selector-label">{m.label}</span><ChevronDown className="composer-selector-chevron text-muted-foreground" /></InputGroupButton>
      </DropdownMenuTrigger></TooltipTrigger><TooltipContent>{m.label}</TooltipContent></Tooltip>
      <DropdownMenuContent align="start" side="top" className="w-72">
        <DropdownMenuLabel>What the agent may do</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={s.mode} onValueChange={(v) => s.setMode(v as Mode)}>
          {(Object.keys(MODES) as Mode[]).map((k) => (
            <DropdownMenuRadioItem key={k} value={k} className="items-start py-2">
              <div><div className="flex items-center gap-2 font-medium">{MODES[k].label}</div><div className="text-xs text-muted-foreground">{MODES[k].help}</div></div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer({ autoFocus, className }: { autoFocus?: boolean; className?: string }) {
  const { preferences: shortcutPreferences, platform: keyboardPlatform } = useShortcutPreferences();
  const s = useStore();
  const everyday = !!s.thread?.task || !!s.agent.connectionId && s.agent.protocol !== 'local-agent' || s.st?.projects.find((p) => p.path === s.project)?.kind === 'personal';
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const uploadBusy = React.useRef(false);
  const context = `${s.project}:${s.thread?.id || 'new'}`; const contextRef = React.useRef(context); contextRef.current = context;
  const attachmentDrafts = React.useRef(new Map<string, Attachment[]>());
  const picker = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const restore = async (event: Event) => {
      const { project, threadId, ids } = (event as CustomEvent<{ project: string; threadId: string; ids: string[] }>).detail;
      const target = `${project}:${threadId}`;
      const values = await Promise.allSettled(ids.map((id) => s.hub.call<Attachment>('readAttachment', id)));
      const files = values.flatMap((result) => result.status === 'fulfilled' ? [{ id: result.value.id, name: result.value.name, size: result.value.size, mime: result.value.mime }] : []);
      const previous = attachmentDrafts.current.get(target) || [];
      const next = [...previous, ...files.filter((file) => !previous.some((item) => item.id === file.id))];
      attachmentDrafts.current.set(target, next); if (contextRef.current === target) setAttachments(next);
    };
    window.addEventListener('tributary:restore-attachments', restore); return () => window.removeEventListener('tributary:restore-attachments', restore);
  }, [s.hub]);
  React.useEffect(() => { setAttachments(attachmentDrafts.current.get(context) || []); }, [context]);
  const changeAttachments = (next: Attachment[]) => { attachmentDrafts.current.set(context, next); setAttachments(next); };
  const attach = async (incoming: File[]) => {
    if (uploadBusy.current || !incoming.length) return;
    const current = attachmentDrafts.current.get(context) || [];
    if (incoming.length + current.length > 8) { toast.error('Attach up to 8 files.'); return; }
    if (incoming.some((file) => !file.size || file.size > 16 * 1024 * 1024) || incoming.reduce((n, file) => n + file.size, current.reduce((n, file) => n + file.size, 0)) > 32 * 1024 * 1024) { toast.error('Up to 16 MB per file and 32 MB total.'); return; }
    const target = context; uploadBusy.current = true; setUploading(true);
    try {
      const input = await Promise.all(incoming.map((file) => new Promise<{ name: string; base64: string }>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read attachment.')); reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] }); reader.readAsDataURL(file); })));
      const added = await s.hub.call<Attachment[]>('addAttachments', input);
      const next = [...(attachmentDrafts.current.get(target) || []), ...added]; attachmentDrafts.current.set(target, next);
      if (contextRef.current === target) setAttachments(next);
    } catch (error) { toast.error((error as Error).message); }
    finally { uploadBusy.current = false; setUploading(false); }
  };
  const [planOn, setPlanOn] = React.useState(false);
  const [researchOn, setResearchOn] = React.useState(false);
  const researchAvailable = s.agent.protocol !== 'direct-chat' && s.agent.capabilities?.tools !== false && s.agent.capabilities?.web !== false;
  const taskMode: TaskMode = researchOn ? 'research' : planOn ? 'plan' : 'ask';
  const selectTaskMode = (mode: TaskMode) => { setPlanOn(mode === 'plan'); setResearchOn(mode === 'research'); };
  React.useEffect(() => { if (!researchAvailable) setResearchOn(false); }, [researchAvailable]);
  const [files, setFiles] = React.useState<{ project: string; list: string[] } | null>(null);
  const [skills, setSkills] = React.useState<{ name: string; description: string }[] | null>(null);
  const suggestionId = React.useId();
  const [sel, setSel] = React.useState(0);
  const [caret, setCaret] = React.useState(0);
  const text = useDraft();

  React.useEffect(() => { if (autoFocus && window.matchMedia('(pointer: fine)').matches) ref.current?.focus(); }, [autoFocus, s.thread?.id]);
  React.useEffect(() => { setFiles(null); setSkills(null); }, [s.project, s.workdir]);

  // Mention / command detection at the caret.
  const before = text.slice(0, caret);
  const at = !s.workdir ? null : /(^|\s)@([^\s@]*)$/.exec(before);
  const slash = everyday ? null : /^\/([\w-]*)$/.exec(before);
  React.useEffect(() => {
    if (at && s.workdir && (!files || files.project !== s.workdir)) s.hub.call<string[]>('listFiles', s.workdir).then((list) => setFiles({ project: s.workdir!, list })).catch(() => setFiles({ project: s.workdir!, list: [] }));
    if (slash && s.project && !skills) s.hub.call<{ name: string; description: string }[]>('skills', s.project).then(setSkills).catch(() => setSkills([]));
  }, [at, slash, s.project, s.workdir, files, skills, s.hub]);

  const replaceToken = (start: number, insert: string) => {
    const next = text.slice(0, start) + insert + text.slice(caret);
    s.setDraft(next);
    requestAnimationFrame(() => { const el = ref.current; if (el) { const pos = start + insert.length; el.focus(); el.setSelectionRange(pos, pos); setCaret(pos); } });
  };

  const projectAttachments = React.useRef(new Map<string, string>());
  const attachProjectFile = async (rel: string) => {
    const target = context; const root = s.workdir; if (!root || uploadBusy.current) return;
    const previous = attachmentDrafts.current.get(target) || [];
    const key = `${target}:${root}:${rel}`;
    if (previous.some((file) => file.id === projectAttachments.current.get(key))) return;
    if (previous.length >= 8) { toast.error('Attach up to 8 files.'); return; }
    uploadBusy.current = true; setUploading(true);
    try {
      const file = await s.hub.call<FileContent>('readFile', root, rel);
      if (file.truncated) throw new Error('File is too large to load. Attach a smaller file.');
      if (file.binary && !file.base64) throw new Error('This binary file cannot be loaded as chat context.');
      if (!file.size) throw new Error('This file is empty. Its path is included in your message.');
      const base64 = file.base64 || await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not load file.')); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(new Blob([file.content])); });
      const [added] = await s.hub.call<Attachment[]>('addAttachments', [{ name: rel, base64 }]);
      const current = attachmentDrafts.current.get(target) || [];
      attachmentDrafts.current.set(target, [...current, added]); projectAttachments.current.set(key, added.id);
      if (contextRef.current === target) setAttachments([...current, added]);
    } catch (error) { toast.error((error as Error).message); }
    finally { uploadBusy.current = false; setUploading(false); }
  };

  let suggestions: Suggest[] = [];
  if (at && files) {
    const q = at[2].toLowerCase();
    const scored = files.list.map((f) => { const l = f.toLowerCase(); const base = l.split('/').pop() || l; const score = !q ? 1 : base.startsWith(q) ? 3 : base.includes(q) ? 2 : l.includes(q) ? 1 : 0; return { f, score }; })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.f.length - b.f.length).slice(0, 8);
    const start = caret - at[2].length - 1;
    suggestions = scored.map(({ f }) => ({ kind: 'file', key: f, label: f, hint: 'Load file', apply: () => { replaceToken(start, `@${/\s/.test(f) ? JSON.stringify(f) : f} `); void attachProjectFile(f); } }));
  } else if (slash) {
    const q = slash[1].toLowerCase();
    suggestions = [
      ...COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({ kind: 'command' as const, key: `/${c.name}`, label: `/${c.name}`, hint: c.hint,
        apply: () => (c.insert ? replaceToken(0, c.insert) : replaceToken(0, `/${c.name} `)) })),
      ...(skills ?? []).filter((k) => k.name.toLowerCase().includes(q)).slice(0, 8).map((k) => ({ kind: 'skill' as const, key: `skill:${k.name}`, label: `/${k.name}`, hint: k.description,
        apply: () => replaceToken(0, `Use the ${k.name} skill. `) })),
    ];
  }
  const showSuggest = caret >= 0 && suggestions.length > 0;
  React.useEffect(() => { setSel(0); }, [showSuggest, at?.[2], slash?.[1]]);

  const submit = async () => {
    const raw = text.trim(); if ((!raw && !attachments.length) || uploading || !s.ready.length) return;
    let body = raw || 'Please inspect the attached files.'; let plan = !everyday && planOn; let research = !everyday && researchOn; let mode: Mode | undefined = everyday ? 'read' : undefined;
    const m = everyday ? null : /^\/([\w-]+)\s*([\s\S]*)$/.exec(raw);
    if (m) {
      const c = COMMANDS.find((x) => x.name === m[1]);
      if (c?.name === 'team') { s.setDraft(m[2].trim()); s.setTeamOpen(true); return; }
      if (c?.name === 'plan') { plan = true; research = false; body = m[2].trim(); if (!body) return; }
      else if (c?.name === 'research') { research = true; plan = false; body = m[2].trim(); if (!body) return; }
      else if (c?.text) { body = m[2].trim() ? `${c.text}\n\n${m[2].trim()}` : c.text; mode = c.mode; }
    }
    if (research && !researchAvailable) { toast.error('Choose a coding agent with web tools for Deep research.'); return; }
    s.setDraft('');
    const ok = await s.send(body, { plan, research, mode, attachments: attachments.map((file) => file.id) });
    if (!ok) s.setDraft(raw); else { changeAttachments([]); selectTaskMode('ask'); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggest) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); suggestions[sel]?.apply(); return; }
      if (e.key === 'Escape') { e.preventDefault(); setCaret(-1); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing && (shortcutPreferences.send === 'enter' || (keyboardPlatform === 'mac' ? e.metaKey : e.ctrlKey))) { e.preventDefault(); submit(); }
  };

  const disabled = !s.ready.length;
  const chatView = !s.codeLayout && !!s.thread?.messages.length && !s.thread.task;
  const workspaceToggle = (s.project && <Tooltip><TooltipTrigger asChild>
            <InputGroupButton size="icon-sm" variant="ghost" aria-label="Workspace" aria-pressed={s.panel.open} onClick={() => { s.setWorkspaceExpanded(false); s.setPanel({ ...s.panel, open: !s.panel.open }); }}><PanelRight /></InputGroupButton>
          </TooltipTrigger><TooltipContent>{s.panel.open ? 'Hide workspace' : 'Open workspace'} <ShortcutLabel action="workspace" /></TooltipContent></Tooltip>);
  const teamToggle = !everyday && s.project && <Tooltip><TooltipTrigger asChild><InputGroupButton size="icon-sm" variant="ghost" aria-label="Create agent team" onClick={() => s.setTeamOpen(true)}><Users /></InputGroupButton></TooltipTrigger><TooltipContent>Create agent team <ShortcutLabel action="team" /></TooltipContent></Tooltip>;
  const agentControls = <><AgentPicker />
          <ModelPicker />
          {!everyday && <><TaskModePicker value={taskMode} onChange={selectTaskMode} compact={s.codeLayout} researchAvailable={researchAvailable} /><ModePicker readOnly={planOn || researchOn} /></>}</>;
  const sendActions = (<div className="composer-send flex shrink-0 items-center gap-1">
            {s.running && <Button size="icon-sm" variant="secondary" className="rounded-full" onClick={s.stop} aria-label="Stop"><Square className="fill-current" /></Button>}
            {(!s.running || !!text.trim() || attachments.length > 0) && (
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" className="rounded-full" onClick={submit} disabled={(!text.trim() && !attachments.length) || disabled || uploading} aria-label={s.running ? 'Queue message' : 'Send'}>{s.running ? <Clock /> : <ArrowUp />}</Button>
              </TooltipTrigger><TooltipContent>{s.running ? 'Send when the current turn ends' : `Send (${shortcutPreferences.send === 'enter' ? 'Enter' : keyboardPlatform === 'mac' ? '⌘+Enter' : 'Ctrl+Enter'})`}</TooltipContent></Tooltip>
            )}
          </div>);
  return (
    <div className={cn('composer-host @container relative min-w-0', className)} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach([...event.dataTransfer.files]); } }}>
      <input ref={picker} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Attach files" onChange={(event) => { void attach([...(event.target.files || [])]); event.target.value = ''; }} />
      {!!attachments.length && <ChatAttachments files={attachments} onRemove={(id) => changeAttachments(attachments.filter((file) => file.id !== id))} />}
      {uploading && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Adding attachments…</p>}
      <ChatReviewBar />
      <QueuedMessages />
      {showSuggest && (
        <div id={suggestionId} role="listbox" aria-label={at ? 'Files' : 'Commands and skills'} className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{at ? 'Add a project file' : 'Commands and skills'}</div>
          {suggestions.map((x, i) => (
            <button id={`${suggestionId}-${i}`} key={x.key} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={x.apply} onMouseEnter={() => setSel(i)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm max-sm:min-h-11', i === sel && 'bg-accent')}>
              {x.kind === 'file' ? <FileTypeIcon path={x.label} /> : x.kind === 'skill' ? <Sparkles className="size-4 shrink-0 text-muted-foreground" /> : <ListTodo className="size-4 shrink-0 text-muted-foreground" />}
              <span className={cn('min-w-0 truncate', x.kind === 'file' && 'font-mono text-[12.5px]')}>{x.label}</span>
              {x.hint && <span className="truncate text-xs text-muted-foreground">{x.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {/* shadcn fades the group when any child is disabled; only fade it when the text box is. */}
      <InputGroup className={cn('composer-surface h-auto rounded-[22px] bg-card shadow-sm has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-foreground/15 has-[[data-slot=input-group-control]:focus-visible]:border-foreground/40 transition-shadow has-disabled:bg-card has-disabled:opacity-100 has-[textarea:focus]:shadow-md dark:bg-card', disabled && 'opacity-60', (s.codeLayout || chatView) && 'rounded-xl shadow-none has-[textarea:focus]:shadow-none', chatView && 'chat-message-box')}>
        {chatView && <InputGroupAddon align="inline-start" className="shrink-0 p-1"><ComposerTools everyday={everyday} planOn={planOn} setPlanOn={(value) => selectTaskMode(value ? 'plan' : 'ask')} researchOn={researchOn} setResearchOn={(value) => selectTaskMode(value ? 'research' : 'ask')} researchAvailable={researchAvailable} focusMessage={() => ref.current?.focus()} onAttach={() => picker.current?.click()} /></InputGroupAddon>}
        <InputGroupTextarea
          ref={ref}
          value={text}
          onChange={(e) => { s.setDraft(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onPaste={(event) => { const pasted = [...event.clipboardData.items].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => !!file); if (pasted.length) { event.preventDefault(); void attach(pasted); } }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? (s.st?.scanningAgents ? 'Finding assistants…' : 'Connect an assistant in Settings to begin.') : everyday ? 'Ask a follow-up or request a change…' : researchOn ? 'What would you like to research?' : planOn ? `Describe the task. ${s.agent.name} will plan first…` : 'Ask anything…'}
          aria-label="Message"
          aria-autocomplete="list" aria-controls={showSuggest ? suggestionId : undefined} aria-activedescendant={showSuggest ? `${suggestionId}-${sel}` : undefined}
          className={cn("max-h-64 min-h-14 px-4 pt-3.5 text-[0.9375rem]", s.codeLayout && "min-h-11 px-3 pt-3 text-sm", chatView && "min-h-11 px-2 py-3 text-[13px]")}
        />
        {!chatView && <InputGroupAddon align="block-end" className={cn("composer-toolbar gap-1 pb-2", s.codeLayout && "px-2 pt-0 pb-1.5")}>
          <div className="composer-primary flex shrink-0 items-center"><ComposerTools everyday={everyday} planOn={planOn} setPlanOn={(value) => selectTaskMode(value ? 'plan' : 'ask')} researchOn={researchOn} setResearchOn={(value) => selectTaskMode(value ? 'research' : 'ask')} researchAvailable={researchAvailable} focusMessage={() => ref.current?.focus()} onAttach={() => picker.current?.click()} />
          {workspaceToggle}{teamToggle}</div>
          <div className="composer-agent-controls flex min-w-0 flex-wrap items-center">{agentControls}</div>
          {sendActions}
        </InputGroupAddon>}
        {chatView && <InputGroupAddon align="inline-end" className="shrink-0 p-1">{sendActions}</InputGroupAddon>}
      </InputGroup>
      {chatView && <div className="chat-composer-options mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{workspaceToggle}{teamToggle}<div className="ml-auto flex flex-wrap items-center justify-end gap-0.5">{agentControls}</div></div>}
    </div>
  );
}

export function HandoffHint() {
  const s = useStore();
  const { preferences, platform } = useShortcutPreferences();
  if (s.thread?.task || s.agent.connectionId) return <p className="mt-2 text-center text-xs text-muted-foreground">A conversation summary follows when you switch assistants. Save useful replies as documents.</p>;
  const msgs = s.thread?.messages ?? [];
  const sendHint = `${preferences.send === 'enter' ? 'Enter' : platform === 'mac' ? '⌘+Enter' : 'Ctrl+Enter'} to send, Shift+Enter for a new line`;
  if (!msgs.length || !s.agentId) return <p className="mt-2 text-center text-xs text-muted-foreground">{sendHint}</p>;
  const name = s.agent.name;
  let last = -1; for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.role === 'assistant' && m.agent === s.agentId) { last = i; break; } }
  let hint = '';
  if (last < 0) hint = `${name} is new to this thread. It will get a summary of the conversation and the working tree.`;
  else {
    const others = msgs.slice(last + 1).filter((m) => m.role === 'assistant' && m.agent !== s.agentId);
    if (others.length) hint = `${name} will catch up on ${others.length} repl${others.length === 1 ? 'y' : 'ies'} from ${[...new Set(others.map((m) => s.agentOf(m.role === 'assistant' ? m.agent : '').name))].join(' and ')}.`;
  }
  return <p className="mt-2 text-center text-xs text-muted-foreground">{hint || sendHint}</p>;
}
