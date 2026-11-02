import * as React from 'react';
import { ArrowUp, Check, ChevronDown, Clock, Cpu, Eye, FileText, ListTodo, PencilLine, Plug, Settings2, Sparkles, Square, Users, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Mode } from '@/types';

export const MODES: Record<Mode, { label: string; help: string; icon: React.ReactNode }> = {
  read: { label: 'Read-only', help: 'Answers and plans. Never changes files.', icon: <Eye /> },
  edit: { label: 'Edit files', help: 'Edits files in this project. Shell commands follow each agent’s own approval rules.', icon: <PencilLine /> },
  full: { label: 'Full auto', help: 'Approves everything, including shell commands. Use in projects you trust.', icon: <Zap /> },
};

const COMMANDS = [
  { name: 'plan', hint: 'Plan first, then approve to run', insert: '/plan ' },
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
        <InputGroupButton size="sm" className="gap-1.5 rounded-full pr-2 pl-1" aria-label="Choose agent and model source">
          {s.ready.length ? <AgentAvatar agent={a} size="xs" /> : null}
          <span className="font-medium">{s.ready.length ? a.name : 'Connect an assistant'}</span>
          {gw && <span className="max-w-28 truncate text-muted-foreground">via {gw.name}</span>}
          <ChevronDown className="text-muted-foreground" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Find an agent or gateway…" />
          <CommandList className="max-h-96">
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Agents">
              {s.ready.map((x) => (
                <CommandItem key={x.id} value={`${x.name} ${x.vendor}`} onSelect={() => { s.setAgentId(x.id); setOpen(false); }} className="gap-2.5">
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

function ModePicker() {
  const s = useStore(); const m = MODES[s.mode];
  return (
    <DropdownMenu>
      <Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
        <InputGroupButton size="sm" className="gap-1.5 rounded-full px-2" aria-label={`Permissions: ${m.label}`}>{m.icon}<span>{m.label}</span><ChevronDown className="text-muted-foreground" /></InputGroupButton>
      </DropdownMenuTrigger></TooltipTrigger><TooltipContent>{m.help}</TooltipContent></Tooltip>
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
  const s = useStore();
  const everyday = !!s.thread?.task || !!s.agent.connectionId || s.st?.projects.find((p) => p.path === s.project)?.kind === 'personal';
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [planOn, setPlanOn] = React.useState(false);
  const [files, setFiles] = React.useState<{ project: string; list: string[] } | null>(null);
  const [skills, setSkills] = React.useState<{ name: string; description: string }[] | null>(null);
  const [sel, setSel] = React.useState(0);
  const [caret, setCaret] = React.useState(0);
  const text = s.draft;

  React.useEffect(() => { if (autoFocus && window.matchMedia('(pointer: fine)').matches) ref.current?.focus(); }, [autoFocus, s.thread?.id]);
  React.useEffect(() => { setFiles(null); setSkills(null); }, [s.project]);

  // Mention / command detection at the caret.
  const before = text.slice(0, caret);
  const at = everyday ? null : /(^|\s)@([^\s@]*)$/.exec(before);
  const slash = everyday ? null : /^\/([\w-]*)$/.exec(before);
  React.useEffect(() => {
    if (at && s.project && (!files || files.project !== s.project)) s.hub.call<string[]>('listFiles', s.project).then((list) => setFiles({ project: s.project!, list })).catch(() => setFiles({ project: s.project!, list: [] }));
    if (slash && s.project && !skills) s.hub.call<{ name: string; description: string }[]>('skills', s.project).then(setSkills).catch(() => setSkills([]));
  }, [at, slash, s.project, files, skills, s.hub]);

  const replaceToken = (start: number, insert: string) => {
    const next = text.slice(0, start) + insert + text.slice(caret);
    s.setDraft(next);
    requestAnimationFrame(() => { const el = ref.current; if (el) { const pos = start + insert.length; el.focus(); el.setSelectionRange(pos, pos); setCaret(pos); } });
  };

  let suggestions: Suggest[] = [];
  if (at && files) {
    const q = at[2].toLowerCase();
    const scored = files.list.map((f) => { const l = f.toLowerCase(); const base = l.split('/').pop() || l; const score = !q ? 1 : base.startsWith(q) ? 3 : base.includes(q) ? 2 : l.includes(q) ? 1 : 0; return { f, score }; })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.f.length - b.f.length).slice(0, 8);
    const start = caret - at[2].length - 1;
    suggestions = scored.map(({ f }) => ({ kind: 'file', key: f, label: f, apply: () => replaceToken(start, `@${f} `) }));
  } else if (slash) {
    const q = slash[1].toLowerCase();
    suggestions = [
      ...COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({ kind: 'command' as const, key: `/${c.name}`, label: `/${c.name}`, hint: c.hint,
        apply: () => (c.insert ? replaceToken(0, c.insert) : replaceToken(0, `/${c.name} `)) })),
      ...(skills ?? []).filter((k) => k.name.toLowerCase().includes(q)).slice(0, 8).map((k) => ({ kind: 'skill' as const, key: `skill:${k.name}`, label: `/${k.name}`, hint: k.description,
        apply: () => replaceToken(0, `Use the ${k.name} skill. `) })),
    ];
  }
  const showSuggest = suggestions.length > 0;
  React.useEffect(() => { setSel(0); }, [showSuggest, at?.[2], slash?.[1]]);

  const submit = async () => {
    const raw = text.trim(); if (!raw || !s.ready.length) return;
    let body = raw; let plan = !everyday && planOn; let mode: Mode | undefined = everyday ? 'read' : undefined;
    const m = everyday ? null : /^\/([\w-]+)\s*([\s\S]*)$/.exec(raw);
    if (m) {
      const c = COMMANDS.find((x) => x.name === m[1]);
      if (c?.name === 'plan') { plan = true; body = m[2].trim(); if (!body) return; }
      else if (c?.text) { body = m[2].trim() ? `${c.text}\n\n${m[2].trim()}` : c.text; mode = c.mode; }
    }
    s.setDraft('');
    const ok = await s.send(body, { plan, mode });
    if (!ok) s.setDraft(raw); else setPlanOn(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggest) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); suggestions[sel]?.apply(); return; }
      if (e.key === 'Escape') { e.preventDefault(); setCaret(-1); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const disabled = !s.ready.length;
  return (
    <div className={cn('relative', className)}>
      {s.queued.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" /><span className="min-w-0 flex-1 truncate">{s.queued.length} message{s.queued.length > 1 ? 's' : ''} waiting: “{s.queued[0].text.slice(0, 80)}”</span>
          <button onClick={s.clearQueue} className="rounded p-0.5 hover:bg-background" aria-label="Clear queued messages"><X className="size-3.5" /></button>
        </div>
      )}
      {showSuggest && (
        <div role="listbox" aria-label={at ? 'Files' : 'Commands and skills'} className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{at ? 'Mention a file' : 'Commands and skills'}</div>
          {suggestions.map((x, i) => (
            <button key={x.key} role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); x.apply(); }} onMouseEnter={() => setSel(i)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm', i === sel && 'bg-accent')}>
              {x.kind === 'file' ? <FileText className="size-4 shrink-0 text-muted-foreground" /> : x.kind === 'skill' ? <Sparkles className="size-4 shrink-0 text-muted-foreground" /> : <ListTodo className="size-4 shrink-0 text-muted-foreground" />}
              <span className={cn('shrink-0', x.kind === 'file' && 'font-mono text-[12.5px]')}>{x.label}</span>
              {x.hint && <span className="truncate text-xs text-muted-foreground">{x.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {/* shadcn fades the group when any child is disabled; only fade it when the text box is. */}
      <InputGroup className={cn('h-auto rounded-[22px] bg-card shadow-sm transition-shadow has-disabled:bg-card has-disabled:opacity-100 has-[textarea:focus]:shadow-md dark:bg-card', disabled && 'opacity-60')}>
        <InputGroupTextarea
          ref={ref}
          value={text}
          onChange={(e) => { s.setDraft(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? (s.st?.scanningAgents ? 'Finding assistants…' : 'Connect an assistant in Settings to begin.') : everyday ? 'Ask a follow-up or request a change…' : planOn ? `Describe the task. ${s.agent.name} will plan first…` : `Message ${s.agent.name}… Type @ for files, / for commands`}
          aria-label="Message"
          className="max-h-64 min-h-14 px-4 pt-3.5 text-[0.9375rem]"
        />
        <InputGroupAddon align="block-end" className="gap-1 pb-2">
          <AgentPicker />
          {!everyday && <>
          <ModePicker />
          <Tooltip><TooltipTrigger asChild>
            <InputGroupButton size="sm" aria-pressed={planOn} onClick={() => setPlanOn((v) => !v)} className={cn('gap-1.5 rounded-full px-2', planOn && 'bg-brand/12 text-brand hover:bg-brand/18 hover:text-brand')}><ListTodo /> Plan</InputGroupButton>
          </TooltipTrigger><TooltipContent>Plan first in read-only mode, then approve to run</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <InputGroupButton size="sm" onClick={() => s.setTeamOpen(true)} disabled={s.ready.length < 2} className="gap-1.5 rounded-full px-2"><Users /> Team</InputGroupButton>
          </TooltipTrigger><TooltipContent>{s.ready.length < 2 ? 'Install a second agent to work as a team' : 'Race agents or run a plan, build and review team'}</TooltipContent></Tooltip>
          </>}
          <div className="ml-auto flex items-center gap-1">
            {s.running && <Button size="icon-sm" variant="secondary" className="rounded-full" onClick={s.stop} aria-label="Stop"><Square className="fill-current" /></Button>}
            {(!s.running || text.trim()) && (
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon-sm" className="rounded-full" onClick={submit} disabled={!text.trim() || disabled} aria-label={s.running ? 'Queue message' : 'Send'}>{s.running ? <Clock /> : <ArrowUp />}</Button>
              </TooltipTrigger><TooltipContent>{s.running ? 'Send when the current turn ends' : 'Send (Enter)'}</TooltipContent></Tooltip>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

export function HandoffHint() {
  const s = useStore();
  if (s.thread?.task || s.agent.connectionId) return <p className="mt-2 text-center text-xs text-muted-foreground">A conversation summary follows when you switch assistants. Save useful replies as documents.</p>;
  const msgs = s.thread?.messages ?? [];
  if (!msgs.length || !s.agentId) return <p className="mt-2 text-center text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line</p>;
  const name = s.agent.name;
  let last = -1; for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.role === 'assistant' && m.agent === s.agentId) { last = i; break; } }
  let hint = '';
  if (last < 0) hint = `${name} is new to this thread. It will get a summary of the conversation and the working tree.`;
  else {
    const others = msgs.slice(last + 1).filter((m) => m.role === 'assistant' && m.agent !== s.agentId);
    if (others.length) hint = `${name} will catch up on ${others.length} repl${others.length === 1 ? 'y' : 'ies'} from ${[...new Set(others.map((m) => s.agentOf(m.role === 'assistant' ? m.agent : '').name))].join(' and ')}.`;
  }
  return <p className="mt-2 text-center text-xs text-muted-foreground">{hint || 'Enter to send, Shift+Enter for a new line'}</p>;
}
