import { LineChangeCount } from '@/components/line-change-count';
import { AgentError } from '@/components/agent-error';
import { ChatAttachments } from '@/components/chat-attachments';
import { ActivityTime, SidebarActivity } from '@/components/sidebar-activity';
import * as React from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, BookmarkPlus, Brain, Check, CircleCheck, CircleX, Copy, FileCode2, FileText, Flag, Globe, History, Info, ListChecks, Play, Repeat2, RotateCcw, Search, ShieldQuestion, SquareTerminal, Wrench,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message';
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { AgentAvatar } from '@/components/agent-avatar';
import { HighlightedCode, Markdown } from '@/components/markdown';
import { changeCode, duration, toolTarget, toolVerb } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import { FileTypeIcon } from '@/components/file-type-icon';
import { replySegments, thinkingExcerpt } from '@/lib/reply-segments.mjs';
import { toolFileReferences } from '@/lib/tool-file-references.mjs';
import type { Agent, AgentMessage, Message as Msg, PermissionRequest, RaceCandidate, ReplyActivity, Tool, UserMessage } from '@/types';

const MODE_LABEL = { read: 'Read-only', edit: 'Edit files', full: 'Full auto' } as const;
const HANDOFF = { join: 'Joined with a summary of this thread', 'catch-up': 'Caught up on the other agents' } as Record<string, string>;

function toolIcon(t: Tool) {
  const v = toolVerb(t);
  if (t.status === 'error') return <AlertCircle />;
  return v === 'Ran' ? <SquareTerminal /> : v === 'Edited' ? <FileCode2 /> : v === 'Read' ? <FileText /> : v === 'Searched' ? <Search /> : v === 'Browsed' ? <Globe /> : <Wrench />;
}

function toolProgress(t: Tool) {
  return ({ Ran: 'Running command', Read: 'Reading files', Edited: 'Editing files', Searched: 'Searching', Browsed: 'Browsing sources', 'Updated plan': 'Updating plan', 'Added task': 'Creating task', 'Updated task': 'Updating task', 'Agent task': 'Delegating task' } as Record<string, string>)[toolVerb(t)] || 'Using tools';
}

function Step({ t }: { t: Tool }) {
  const s = useStore();
  const files = toolFileReferences(t, s.workdir);
  const target = toolTarget(t, s.workdir);
  const fileLink = (file: (typeof files)[number], compact = false) => <button key={file.rel} type="button" aria-label={`Open ${file.rel} in code editor`} title={file.rel} onClick={() => s.editFile(file.rel, file.line, file.column)} className="inline-flex min-w-0 max-w-full max-sm:min-h-11 items-center gap-1 rounded text-left text-[12.5px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"><FileTypeIcon path={file.rel} /><span className="truncate">{compact && files.filter((item) => item.rel.split('/').pop() === file.rel.split('/').pop()).length === 1 ? file.rel.split('/').pop() : file.rel}{file.line ? `:${file.line}` : ''}</span></button>;
  const direct = files.length === 1 && toolVerb(t) !== 'Ran';
  const command = toolVerb(t) === 'Ran' ? target : '';
  const details = !!t.output || !!command;
  const line = (
    <TraceLine status={t.status === 'running' ? 'running' : t.status === 'error' ? 'error' : undefined}>
      <TraceIcon>{t.status === 'running' ? <Spinner /> : toolIcon(t)}</TraceIcon>
      <TraceTitle>{t.status === 'running' ? toolProgress(t) : toolVerb(t)}</TraceTitle>
      <TraceDescription className="min-w-0 shrink! truncate font-mono text-[12.5px]" title={target}>{direct ? fileLink(files[0]) : target}</TraceDescription>
    </TraceLine>
  );
  return (
    <TraceCollapsible>
      <div className="flex min-w-0 items-center gap-1">{line}{details && <TraceCollapsibleTrigger className="shrink-0" aria-label={`Show details: ${toolVerb(t)} ${target}`} />}</div>
      {!direct && files.length > 0 && <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 pl-6">{files.map((file) => fileLink(file, true))}</div>}
      {details && <TraceCollapsibleContent>
        <div className="min-w-0 space-y-2 py-1">{command && <HighlightedCode code={command} language="bash" wrap />}{t.output && <HighlightedCode code={t.output} language={command ? 'ansi' : 'text'} wrap />}</div>
      </TraceCollapsibleContent>}
    </TraceCollapsible>
  );
}

function Activity({ m, entries, live = false }: { m: AgentMessage; entries: ReplyActivity[]; live?: boolean }) {
  const s = useStore();
  const [open, setOpen] = React.useState<boolean | null>(null);
  if (s.codeLayout) return <SidebarActivity m={m} entries={entries} live={live} />;
  const steps = entries.flatMap((entry) => entry.kind === 'tool' && m.tools[entry.toolIndex] ? [m.tools[entry.toolIndex]] : []);
  const lastRun = [...steps].reverse().find((tool) => tool.status === 'running');
  const waiting = live && (m.permissions || []).some((request) => request.status === 'pending');
  const last = entries.at(-1);
  const summaries: string[] = [];
  for (const [verb, label] of [['Read', 'Read files'], ['Searched', 'Searched files'], ['Edited', 'Edited files'], ['Browsed', 'Browsed sources']] as const) if (steps.some((tool) => toolVerb(tool) === verb)) summaries.push(label);
  const commands = steps.filter((tool) => toolVerb(tool) === 'Ran').length;
  if (commands) summaries.push(`Ran ${commands} command${commands === 1 ? '' : 's'}`);
  const completed = summaries.join(' · ') || (steps.length ? `${steps.length} tool ${steps.length === 1 ? 'call' : 'calls'}` : entries.some((entry) => entry.kind === 'plan') ? 'Updated plan' : 'Thought');
  const label = waiting ? 'Waiting for your answer' : live && s.running && m.modelPhase === 'waiting-model' ? 'Waiting for local model' : live ? lastRun ? toolProgress(lastRun) : last?.kind === 'thinking' ? 'Thinking' : last?.kind === 'plan' ? 'Planning' : 'Processing' : completed;
  return <Trace className="reply-activity" aria-label="Reply activity">
    <TraceCollapsible open={open ?? live} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={live ? 'running' : undefined}>
          <TraceIcon>{live ? <Spinner /> : steps.length ? <ListChecks /> : <Brain />}</TraceIcon>
          <TraceTitle>{label}</TraceTitle>
          {live && lastRun && <TraceDescription className="min-w-0 shrink! truncate font-mono text-[12.5px]">{toolTarget(lastRun, s.workdir)}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex min-w-0 flex-col gap-2">
          {entries.map((entry, index) => {
            if (entry.kind === 'tool') return m.tools[entry.toolIndex] ? <Step key={`tool:${entry.toolIndex}`} t={m.tools[entry.toolIndex]} /> : null;
            if (entry.kind === 'thinking') {
              const text = thinkingExcerpt(m, entry);
              return text ? <TraceCollapsible key={`thinking:${index}`}>
                <TraceCollapsibleTrigger><TraceLine><TraceIcon><Brain /></TraceIcon><TraceTitle>{live && last === entry ? 'Thinking' : 'Thought'}</TraceTitle></TraceLine></TraceCollapsibleTrigger>
                <TraceCollapsibleContent><p className="max-h-60 overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{text}</p></TraceCollapsibleContent>
              </TraceCollapsible> : <TraceLine key={`thinking:${index}`}><TraceIcon><Brain /></TraceIcon><TraceTitle>Thought</TraceTitle></TraceLine>;
            }
            return <ul key={`plan:${index}`} className="flex flex-col gap-1 py-0.5 text-[13px]" aria-label="Agent plan">{entry.items.map((item, i) => <li key={i} className={cn('flex items-start gap-2', item.done && 'text-muted-foreground line-through')}><Checkbox checked={!!item.done} disabled aria-hidden tabIndex={-1} className="mt-0.5 disabled:cursor-default disabled:opacity-100" /><span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>{item.text}</li>)}</ul>;
          })}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>;
}

function LegacyActivity({ m }: { m: AgentMessage }) {
  const entries: ReplyActivity[] = [];
  if (m.thinking) entries.push({ kind: 'thinking', textOffset: 0, start: 0, end: m.thinking.length });
  if (m.plan) entries.push({ kind: 'plan', textOffset: 0, items: m.plan });
  entries.push(...(m.tools || []).map((_, toolIndex) => ({ kind: 'tool' as const, textOffset: 0, toolIndex })));
  return entries.length ? <Activity m={m} entries={entries} /> : null;
}

function LiveProgress({ m, active }: { m: AgentMessage; active: boolean }) {
  const waiting = (m.permissions || []).some((request) => request.status === 'pending');
  const running = [...(m.tools || [])].reverse().find((tool) => tool.status === 'running');
  const last = m.trace?.at(-1);
  const label = waiting ? 'Waiting for your answer' : active && m.modelPhase === 'waiting-model' ? 'Waiting for local model' : running ? toolProgress(running) : last?.kind === 'thinking' && last.endedAt == null ? 'Thinking' : m.text ? 'Writing response' : active && m.modelPhase === 'generating' ? 'Generating response' : 'Processing request';
  return <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2 py-1 text-[13px] text-muted-foreground"><Spinner className="size-3.5 shrink-0" /><span>{label}</span></div>;
}

const ASKS: Record<string, string> = { execute: 'run a command', edit: 'edit a file', delete: 'delete a file', move: 'move a file', read: 'read a file', search: 'search', fetch: 'fetch from the web', permissions: 'request additional access' };

/** A tool call the agent is waiting on: allow it once, for the rest of the agent session, or deny it. */
function PermissionCard({ r, agent }: { r: PermissionRequest; agent: Agent }) {
  const s = useStore(); const [busy, setBusy] = React.useState(false);
  const answer = async (choice: 'once' | 'always' | 'reject') => {
    setBusy(true);
    try { await s.hub.call('answerPermission', r.id, choice); } catch (e) { toast.error((e as Error).message); setBusy(false); }
  };
  const rel = r.path && s.project && r.path.startsWith(`${s.project}/`) ? r.path.slice(s.project.length + 1) : r.path;
  const detail = r.command || rel || r.detail;
  const always = r.kind === 'edit' ? 'Allow every edit for the rest of this agent session' : r.command ? 'Allow this exact command for the rest of this agent session' : 'Allow this tool for the rest of this agent session';
  return (
    <Alert className="border-brand/40" aria-label={`Permission request: ${r.title}`}>
      <ShieldQuestion className="text-brand" />
      <AlertTitle>{agent.name} wants to {ASKS[r.kind] ?? `use ${r.title}`}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-1.5">
        {detail ? <code className="block overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-[12.5px] whitespace-pre-wrap break-all text-foreground">{detail}</code> : null}
        {(!detail || !r.title.includes(detail)) && <span>{r.title}</span>}
      </AlertDescription>
      <div className="col-start-2 mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => answer('once')}>Allow once</Button>
        <Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" disabled={busy} onClick={() => answer('always')}>Always allow</Button></TooltipTrigger><TooltipContent>{always}</TooltipContent></Tooltip>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => answer('reject')}>Deny</Button>
      </div>
    </Alert>
  );
}

function AgentQuestionCard({ r, agent }: { r: PermissionRequest; agent: Agent }) {
  const s = useStore(); const id = React.useId();
  const [selected, setSelected] = React.useState<Record<string, string[]>>({}); const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const answers = Object.fromEntries((r.questions || []).map((q) => [q.question, custom[q.question]?.trim() || (selected[q.question] || []).join(', ')]));
  const answer = async (skip = false) => { setBusy(true); setError(''); try { await s.hub.call('answerPermission', r.id, skip ? 'reject' : { answers }); } catch (e) { setError((e as Error).message); setBusy(false); } };
  return <section aria-label={`Question from ${agent.name}`} className="rounded-xl border bg-card p-4">
    <h3 className="mb-3 text-[13px] font-medium">{agent.name} needs your input</h3>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void answer(); }}>
      {(r.questions || []).map((q, index) => <fieldset key={q.question} disabled={busy} className="space-y-2"><legend className="mb-2 text-[13px] font-medium">{q.question}</legend>
        {q.options.map((option) => <label key={option.label} className="flex min-h-9 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs has-checked:border-brand/60 has-checked:bg-muted max-sm:min-h-11"><input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${id}-${index}`} value={option.label} checked={(selected[q.question] || []).includes(option.label)} onChange={(e) => { setCustom((all) => ({ ...all, [q.question]: '' })); setSelected((all) => ({ ...all, [q.question]: q.multiSelect ? e.target.checked ? [...(all[q.question] || []), option.label] : (all[q.question] || []).filter((item) => item !== option.label) : [option.label] })); }} className="mt-0.5 shrink-0 accent-current" /><span className="min-w-0"><span className="font-medium">{option.label}</span>{option.description && <span className="mt-1 block text-muted-foreground">{option.description}</span>}</span></label>)}
        <Input aria-label={`Your answer: ${q.question}`} placeholder="Write your own answer…" maxLength={2000} value={custom[q.question] || ''} onChange={(e) => { setCustom((all) => ({ ...all, [q.question]: e.target.value })); setSelected((all) => ({ ...all, [q.question]: [] })); }} />
      </fieldset>)}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || Object.values(answers).some((value) => !value)}>Send answers</Button><Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void answer(true)}>Skip</Button></div>
    </form>
  </section>;
}

function ReplyContent({ m, agent }: { m: AgentMessage; agent: Agent }) {
  const s = useStore();
  const live = m.ok == null;
  const parts = replySegments(m.text || '', m.permissions, m.trace);
  return <div className={cn('reply-timeline flex min-w-0 flex-col gap-3', s.codeLayout && 'sidebar-reply-timeline')}>
    {!m.trace && <LegacyActivity m={m} />}
    {parts.map((part, index) => {
      if (part.kind === 'activity') return <Activity key={part.id} m={m} entries={part.entries} live={live && index === parts.length - 1} />;
      if (part.kind === 'text') return <div key={`text:${index}`} className={cn(s.codeLayout && 'sidebar-timeline-item')}><Markdown text={part.text} /></div>;
      const r = part.request;
      if (r.status === 'pending' && live && s.running) return <div key={r.id} className={cn(s.codeLayout && 'sidebar-timeline-item')} data-status="pending">{r.questions ? <AgentQuestionCard r={r} agent={agent} /> : <PermissionCard r={r} agent={agent} />}</div>;
      const label = r.status === 'allowed' ? 'Allowed once' : r.status === 'always' ? 'Always allowed' : r.status === 'rejected' ? 'Denied' : 'Cancelled';
      return <details key={r.id} className={cn('min-w-0 text-xs text-muted-foreground', s.codeLayout && 'sidebar-timeline-item')}><summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-ring"><span className="inline-flex max-w-full items-center gap-1.5 align-middle"><ShieldQuestion className="size-3.5 shrink-0" /><span className="truncate">{label} · {r.title}</span></span></summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono">{r.command || r.path || r.detail || r.title}</pre></details>;
    })}
    {live && (s.codeLayout || parts.at(-1)?.kind !== 'activity') && <div className={cn(s.codeLayout && 'sidebar-timeline-item')} data-status="running"><LiveProgress m={m} active={s.running} /></div>}
  </div>;
}

function FilesChanged({ m }: { m: AgentMessage }) {
  const s = useStore(); const files = (m.files || []).filter((f) => !f.external);
  if (!files.length) return null;
  const counted = files.every((file) => file.binary || file.added != null && file.removed != null);
  const total = counted ? files.reduce((counts, file) => ({ added: counts.added + (file.added || 0), removed: counts.removed + (file.removed || 0) }), { added: 0, removed: 0 }) : {};
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <FileCode2 className="size-4 text-muted-foreground" />
        <span className="font-medium">{files.length} file{files.length > 1 ? 's' : ''} changed</span><LineChangeCount {...total} />
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => s.openReview(files[0].rel)}>Review</Button>
      </div>
      <ul>
        {files.slice(0, 8).map((f) => (
          <li key={f.path}>
            <div className="group/row flex items-center hover:bg-muted/60">
              <button className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left text-sm" onClick={() => s.openReview(f.rel)} title="Show the diff">
                <FileTypeIcon path={f.rel} />
                <ChangeCode code={changeCode(f.change)} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{f.rel}</span><LineChangeCount {...f} />
              </button>
              <button className="mr-2 rounded p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100" onClick={() => s.editFile(f.rel)} aria-label={`Edit ${f.rel}`}><FileCode2 className="size-3.5" /></button>
            </div>
          </li>
        ))}
        {files.length > 8 && <li><button className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60" onClick={() => s.openReview(null)}>{files.length - 8} more in Review</button></li>}
      </ul>
    </div>
  );
}

function DelegatedWorkers({ m }: { m: AgentMessage }) {
  const s = useStore(); if (!m.delegations?.length) return null;
  return <section aria-label="Delegated workers" className="overflow-hidden rounded-xl border bg-card">
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium"><span className="flex-1">Background agents</span><span className="tabular-nums text-muted-foreground">{m.delegations.length}</span></div>
    {m.delegations.map((worker) => {
      const busy = worker.state === 'running' || worker.state === 'starting';
      return <div key={worker.id} className="border-b px-3 py-2.5 last:border-0">
        <div className="flex min-w-0 items-center gap-2 text-xs"><AgentAvatar agent={s.agentOf(worker.agentId)} size="xs" /><span className="min-w-0 flex-1 truncate font-medium">{s.agentOf(worker.agentId).name}</span><span className={cn('flex shrink-0 items-center gap-1.5', worker.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{busy && <Spinner className="size-3" />}{worker.state === 'done' ? 'Ready to review' : worker.state === 'starting' ? 'Starting' : worker.state === 'running' ? 'Working' : worker.state}</span></div>
        <p className="mt-1.5 break-words text-[13px] leading-5">{worker.title}</p>
        {(worker.branch || worker.model) && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={[worker.branch, worker.model].filter(Boolean).join(' · ')}>{[worker.branch, worker.model].filter(Boolean).join(' · ')}</p>}
        {worker.error && <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-destructive">{worker.error}</p>}
        {!!worker.files?.length && <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><FileCode2 className="size-3.5" /><span>{worker.fileCount ?? worker.files.length} {(worker.fileCount ?? worker.files.length) === 1 ? 'file' : 'files'} in this worker</span></div>}
        <div className="mt-2 flex flex-wrap items-center gap-1"><Button size="xs" variant="outline" onClick={() => s.openThread(worker.id)} aria-label={`Open worker chat: ${worker.title}`}>Open chat</Button>{!!worker.files?.length && <Button size="xs" variant="ghost" onClick={async () => { await s.openThread(worker.id); await s.openReview(null); }}>Review changes</Button>}{busy && <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => s.hub.call('stop', worker.id).catch((e: Error) => toast.error(e.message))}>Stop worker</Button>}</div>
      </div>;
    })}
  </section>;
}

export function ChangeCode({ code }: { code: string }) {
  const label = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed' }[code] || code;
  return <span title={label} aria-label={label} className={cn('w-4 shrink-0 text-center font-mono text-[11px] font-semibold', code === 'A' && 'text-success', code === 'D' && 'text-destructive', code === 'M' && 'text-warning')}>{code}</span>;
}

function AskAnother({ m, prompt }: { m: AgentMessage; prompt?: UserMessage }) {
  const s = useStore();
  if (!prompt) return null;
  const others = s.ready.filter((a) => a.id !== m.agent);
  if (!others.length) return null;
  return (
    <DropdownMenu>
      <Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Ask another agent"><Repeat2 /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Ask another agent</TooltipContent></Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Send the same request to…</DropdownMenuLabel>
        {others.map((a) => (
          <DropdownMenuItem key={a.id} disabled={s.running} onClick={() => { s.setAgentId(a.id); s.hub.call('send', { threadId: s.thread!.id, agentId: a.id, text: prompt.text, mode: m.mode, research: m.kind === 'research', plan: m.kind === 'plan', gatewayId: null, model: s.modelFor(a.id) || null }).catch((e: Error) => toast.error(e.message)); }}>
            <AgentAvatar agent={a} size="xs" /> {a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RestoreCheckpoint({ m }: { m: AgentMessage }) {
  const s = useStore();
  if (!m.checkpoint || m.ok == null || m.mode === 'read') return null;
  const restore = async () => {
    try {
      const r = await s.hub.call<{ restored: number; removed: number }>('restoreCheckpoint', s.thread!.id, m.id);
      toast.success(`Restored files to before this turn. ${r.restored} restored, ${r.removed} removed.`); s.refreshGit();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <AlertDialog>
      <Tooltip><TooltipTrigger asChild><AlertDialogTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Restore files to before this turn" disabled={s.running}><History /></Button></AlertDialogTrigger></TooltipTrigger><TooltipContent>Restore files to before this turn</TooltipContent></Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore files to before this turn?</AlertDialogTitle>
          <AlertDialogDescription>Every file changed since this turn started goes back to how it was, including changes made by later turns and by you. Files this turn created are deleted. Commits and the conversation are not affected.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={restore}>Restore files</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// The project's checks after this turn: running, passed, or failed with its output and a Fix that hands the output
// to the same agent. A script you have not trusted yet waits for your OK.
function Checks({ m }: { m: AgentMessage }) {
  const s = useStore(); const v = m.verify; const t = s.thread;
  if (!v || !t) return null;
  const run = async (trust?: string) => {
    try { if (trust) await s.hub.call('trustScript', t.project, trust); await s.hub.call('runVerify', t.id, m.id); }
    catch (e) { toast.error((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
  };
  const fix = () => s.send(`The checks failed after your changes (\`${v.command}\`). Find and fix the cause, then run them again.\n\n\`\`\`\n${(v.output || '').slice(-3000)}\n\`\`\``, { agentId: m.agent });
  if (v.state === 'running') return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="size-3" /> Running checks: <code className="truncate">{v.command}</code></p>;
  if (v.state === 'passed') return <p className="flex items-center gap-1.5 text-xs text-success" title={v.command}><CircleCheck className="size-3.5" /> Checks passed{v.ms ? ` in ${duration(v.ms)}` : ''}</p>;
  if (v.state === 'untrusted') return <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ShieldQuestion className="size-3.5" /> Run this project's checks? <code className="truncate">{v.command}</code><Button size="xs" variant="outline" onClick={() => run(v.hash)}>Trust and run</Button></p>;
  if (v.state === 'stopped') return <p className="flex items-center gap-1.5 text-xs text-muted-foreground">Checks stopped <Button size="xs" variant="ghost" onClick={() => run()}>Run again</Button></p>;
  return (
    <details className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-destructive"><CircleX className="size-3.5" /> Checks failed: <code className="min-w-0 flex-1 truncate">{v.command}</code>
        <Button size="xs" variant="outline" onClick={(e) => { e.preventDefault(); fix(); }}>Fix</Button><Button size="xs" variant="ghost" onClick={(e) => { e.preventDefault(); run(); }}>Run again</Button></summary>
      <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground">{(v.output || '').slice(-3000)}</pre>
    </details>
  );
}

function RunPlan({ m }: { m: AgentMessage }) {
  const s = useStore();
  if (m.kind !== 'plan' || !m.ok || !m.text) return null;
  const run = (agentId: string) => {
    s.setAgentId(agentId); if (s.mode === 'read') s.setMode('edit');
    s.hub.call('send', { threadId: s.thread!.id, agentId, text: '', mode: s.mode === 'read' ? 'edit' : s.mode, gatewayId: agentId === m.agent ? m.gatewayId || null : null, model: agentId === m.agent ? m.model || null : s.modelFor(agentId) || null, planFrom: m.id }).catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" onClick={() => run(m.agent)} disabled={s.running}><Play /> Run this plan</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={s.running}>With another agent</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {s.ready.map((a) => <DropdownMenuItem key={a.id} onClick={() => run(a.id)}><AgentAvatar agent={a} size="xs" /> {a.name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CopyReply({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon-xs" aria-label="Copy reply" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => toast.error('Copy failed'))}>{done ? <Check /> : <Copy />}</Button>
    </TooltipTrigger><TooltipContent>{done ? 'Copied' : 'Copy reply'}</TooltipContent></Tooltip>
  );
}

function Retry({ m, prompt }: { m: AgentMessage; prompt?: UserMessage }) {
  const s = useStore();
  if (m.ok !== false || !prompt || m.kind === 'race' || m.networkInterrupted) return null;
  return (
    <Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon-xs" aria-label="Try again" disabled={s.running}
        onClick={() => s.hub.call('send', { threadId: s.thread!.id, agentId: m.agent, text: prompt.text, mode: m.mode, research: m.kind === 'research', plan: m.kind === 'plan', gatewayId: m.gatewayId || null, model: m.model || null }).catch((e: Error) => toast.error(e.message))}><RotateCcw /></Button>
    </TooltipTrigger><TooltipContent>Try again</TooltipContent></Tooltip>
  );
}

function Remember({ m }: { m: AgentMessage }) {
  const s = useStore(); const [open, setOpen] = React.useState(false); const [note, setNote] = React.useState('');
  if (!m.text || m.ok == null) return null;
  const first = m.text.replace(/```[\s\S]*?```/g, '').split('\n').map((l) => l.trim()).find((l) => l.length > 20) || m.text.slice(0, 200);
  return (
    <>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Remember this for every agent" onClick={() => { setNote(first.replace(/^[-*#>\s]+/, '').slice(0, 300)); setOpen(true); }}><BookmarkPlus /></Button></TooltipTrigger><TooltipContent>Remember this for every agent</TooltipContent></Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Remember for every agent</DialogTitle><DialogDescription>Saved as one line in .tributary/memory.md. Every agent reads it before starting work in this project.</DialogDescription></DialogHeader>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note to remember" />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!note.trim()} onClick={async () => { try { await s.hub.call('remember', s.project, note); toast.success('Saved to project memory'); setOpen(false); } catch (e) { toast.error((e as Error).message); } }}>Remember</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const TESTS: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
  passed: { label: 'Tests passed', cls: 'border-success/40 bg-success/10 text-success', icon: <CircleCheck className="size-3.5" /> },
  failed: { label: 'Tests failed', cls: 'border-destructive/40 bg-destructive/10 text-destructive', icon: <CircleX className="size-3.5" /> },
  running: { label: 'Running tests', cls: 'text-muted-foreground' }, pending: { label: 'Tests pending', cls: 'text-muted-foreground' }, skipped: { label: 'No tests', cls: 'text-muted-foreground' },
};

function Candidate({ c, m }: { c: RaceCandidate; m: AgentMessage }) {
  const s = useStore(); const a = s.agentOf(c.agent); const [show, setShow] = React.useState<'diff' | 'reply' | 'tests' | null>(null);
  const applied = m.race?.applied; const winner = applied === c.agent; const recommended = !applied && m.race?.judge?.winner === c.agent;
  const t = TESTS[c.tests ?? 'skipped'] ?? TESTS.skipped;
  return (
    <div className={cn('flex min-w-0 flex-col rounded-xl border bg-card', winner && 'border-success ring-1 ring-success', recommended && 'border-brand ring-1 ring-brand')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <AgentAvatar agent={a} size="sm" /><span className="min-w-0 truncate font-medium">{a.name}</span>
        {recommended && <Badge className="shrink-0 bg-brand/15 text-brand">Recommended</Badge>}
        {c.status === 'running' ? <Spinner className="ml-auto size-3.5" /> : <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap', t.cls)}>{t.icon}{t.label}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2 text-[12.5px]">
        {c.status === 'running' ? <span className="truncate font-mono text-muted-foreground">{c.tests === 'running' ? 'Running your tests…' : c.activity || 'Working…'}</span> : (
          <>
            {c.error && <span className="text-destructive">{c.error.split('\n')[0]}</span>}
            <span className="text-muted-foreground">{c.files?.length ? `${c.files.length} file${c.files.length > 1 ? 's' : ''} changed${c.stat ? `, ${c.stat.replace(/^\s*\d+ files? changed,?\s*/, '')}` : ''}` : 'No changes'}{c.durationMs ? `, ${duration(c.durationMs)}` : ''}</span>
            {c.files?.slice(0, 4).map((f) => <span key={f} className="truncate font-mono text-[12px]">{f}</span>)}
            {c.branch && c.files?.length ? (
              <button className="mt-0.5 self-start truncate rounded font-mono text-[11px] text-muted-foreground hover:text-foreground" title="Copy the branch name. Check it out to keep working on this attempt."
                onClick={() => navigator.clipboard.writeText(c.branch!).then(() => toast.success('Branch name copied'), () => {})}>on {c.branch}</button>
            ) : null}
          </>
        )}
      </div>
      {c.status === 'done' && (
        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          {c.diff ? <Button size="xs" variant={show === 'diff' ? 'secondary' : 'ghost'} onClick={() => setShow(show === 'diff' ? null : 'diff')}>Diff</Button> : null}
          {c.text ? <Button size="xs" variant={show === 'reply' ? 'secondary' : 'ghost'} onClick={() => setShow(show === 'reply' ? null : 'reply')}>Reply</Button> : null}
          {c.testOutput ? <Button size="xs" variant={show === 'tests' ? 'secondary' : 'ghost'} onClick={() => setShow(show === 'tests' ? null : 'tests')}>Test output</Button> : null}
          <Button size="xs" className="ml-auto" variant={winner ? 'secondary' : 'default'} disabled={!!applied || !c.diff || s.running}
            onClick={async () => { try { await s.hub.call('applyRace', s.thread!.id, m.id, c.agent); toast.success(`Applied ${a.name}’s changes`); s.refreshGit(); } catch (e) { toast.error((e as Error).message); } }}>
            {winner ? <><Check /> Applied</> : 'Apply'}
          </Button>
        </div>
      )}
      {show === 'diff' && c.diff && <div className="border-t p-2"><HighlightedCode code={c.diff} language="diff" /></div>}
      {show === 'reply' && c.text && <div className="max-h-80 overflow-auto border-t px-3 py-2"><Markdown text={c.text} /></div>}
      {show === 'tests' && c.testOutput && <div className="border-t p-2"><HighlightedCode code={c.testOutput} language="ansi" wrap /></div>}
    </div>
  );
}

// One agent compares the candidates' diffs and test results and recommends one. Applying stays your call.
function RaceJudge({ m }: { m: AgentMessage }) {
  const s = useStore(); const r = m.race!; const j = r.judge;
  if (r.applied || r.candidates.filter((c) => c.status === 'done' && c.diff).length < 2) return null;
  const judge = async (id: string) => {
    try {
      const v = await s.hub.call<{ winner: string | null }>('judgeRace', s.thread!.id, m.id, id);
      toast.success(v.winner ? `${s.agentOf(id).name} recommends ${s.agentOf(v.winner).name}` : `${s.agentOf(id).name} recommends none of them`);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {j && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><AgentAvatar agent={s.agentOf(j.agent)} size="xs" />{s.agentOf(j.agent).name} {j.winner ? <>recommends <strong className="font-medium text-foreground">{s.agentOf(j.winner).name}</strong></> : 'recommends none of them'}.</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" variant="outline" disabled={s.running}>{j ? 'Ask another agent' : 'Pick the best with…'}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Compares every diff and test result</DropdownMenuLabel>
          {s.ready.map((a) => <DropdownMenuItem key={a.id} onClick={() => judge(a.id)}><AgentAvatar agent={a} size="xs" />{a.name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RaceTurn({ m }: { m: AgentMessage }) {
  const r = m.race!; const live = m.ok == null;
  const passed = r.candidates.filter((c) => c.tests === 'passed').length;
  return (
    <Message>
      <MessageContent>
        <MessageHeader className="flex flex-wrap items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full bg-brand text-white"><Flag className="size-3.5" /></span>
          <span className="font-semibold">Race</span>
          <span className="text-xs text-muted-foreground">{r.candidates.length} agents, each in its own copy of the project{r.testCommand ? <>, checked with <code className="font-mono">{r.testCommand}</code></> : ''}</span>
        </MessageHeader>
        <p className="text-sm text-muted-foreground">
          {live ? 'The agents are working. Your files stay untouched until you apply a result.'
            : r.applied ? 'A result was applied to your project. Every attempt stays on its own branch if you want to look again.'
              : `Done.${r.testCommand ? ` ${passed} of ${r.candidates.length} passed the tests.` : ''} Compare the results and apply the one you want.`}
        </p>
        {!live && <RaceJudge m={m} />}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{r.candidates.map((c) => <Candidate key={c.agent} c={c} m={m} />)}</div>
        {m.error && <Alert variant="destructive"><AlertCircle /><AlertDescription>{m.error}</AlertDescription></Alert>}
        {(m.notices || []).map((n, i) => <p key={i} className="flex items-center gap-1.5 text-sm text-success"><Check className="size-3.5" /> {n}</p>)}
      </MessageContent>
    </Message>
  );
}

function AgentTurn({ m, agent, prompt }: { m: AgentMessage; agent: Agent; prompt?: UserMessage }) {
  const s = useStore();
  const live = m.ok == null;
  const usage = m.usage || {};
  const tokens = usage.output_tokens != null ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : usage.total_tokens;
  return (
    <Message>
      <MessageContent>
        <MessageHeader className="flex flex-wrap items-center gap-2">
          <AgentAvatar agent={agent} size={s.codeLayout ? 'sm' : 'md'} />
          <span className="font-semibold">{agent.name}</span>
          {m.model && <span className="max-w-48 truncate text-xs text-muted-foreground" title={`Requested model: ${m.model}`}>{m.model}</span>}
          {m.team && <Badge variant="secondary" className="capitalize">{m.team.role === 'member' ? 'Answering' : m.team.role}</Badge>}
          {m.kind === 'plan' || m.kind === 'research' ? <Badge variant="secondary">{m.kind === 'research' ? 'Deep research' : 'Plan'}</Badge> : <Badge variant="outline" className="font-normal text-muted-foreground">{MODE_LABEL[m.mode] ?? m.mode}</Badge>}
          {m.gateway && <Badge variant="outline" className="border-brand/30 font-normal text-brand">via {m.gateway}</Badge>}
          {m.handoff && HANDOFF[m.handoff] && <span className="text-xs text-muted-foreground">{HANDOFF[m.handoff]}</span>}
          {s.codeLayout && <ActivityTime ts={m.ts} />}
        </MessageHeader>
        <ReplyContent m={m} agent={agent} />
        {(m.notices || []).map((n, i) => <p key={i} className="flex items-center gap-1.5 text-sm text-warning"><Info className="size-3.5" /> {n}</p>)}
        {m.memoryContext && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Project memory included · {m.memoryContext.characters.toLocaleString()} characters</summary><ul className="mt-2 space-y-1">{m.memoryContext.sources.map((source) => <li key={`${source.source}:${source.line}`}>{source.source}:{source.line}</li>)}</ul></details>}
        {m.error && <AgentError text={m.error} agent={m.agent} />}
        {m.networkInterrupted && m.ok === false && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-muted/30 p-3"><div className="min-w-0"><p className="text-sm font-medium">Connection interrupted</p><p className="mt-1 text-xs text-muted-foreground">Your changes are kept. Reconnect, then continue from completed work.</p></div><Button size="sm" variant="outline" disabled={s.running || s.thread?.messages.filter((message) => message.role === 'assistant').at(-1)?.id !== m.id} onClick={() => s.hub.call('resumeTurn', s.thread!.id, m.id).catch((e: Error) => toast.error(e.message))}><Play />Resume</Button></div>}
        <FilesChanged m={m} />
        {!live && <Checks m={m} />}
        <DelegatedWorkers m={m} />
        <RunPlan m={m} />
        {!live && (
          <MessageFooter className="flex items-center gap-0.5 text-xs text-muted-foreground">
            {m.ok === false && <span className="mr-2 font-medium text-destructive">Failed</span>}
            {m.durationMs ? <span className="mr-3 tabular-nums">{duration(m.durationMs)}</span> : null}
            {m.costUsd ? <span className="mr-3 tabular-nums">${m.costUsd.toFixed(3)}</span> : null}
            {tokens ? <span className="mr-3 tabular-nums">{tokens.toLocaleString()} tokens</span> : null}
            <span className="reply-actions flex items-center opacity-100 transition-opacity md:opacity-0 md:group-hover/turn:opacity-100 md:group-focus-within/turn:opacity-100">
              <Retry m={m} prompt={prompt} />
              {m.text && <CopyReply text={m.text} />}
              {m.text && m.ok === true && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Save as document" onClick={() => s.makeDocument(m.id).catch((e) => toast.error(e.message || String(e)))}><FileText /></Button></TooltipTrigger><TooltipContent>Save as editable document</TooltipContent></Tooltip>}
              <Remember m={m} />
              <AskAnother m={m} prompt={prompt} />
              <RestoreCheckpoint m={m} />
            </span>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function AgentAvatarName({ id }: { id: string }) {
  const s = useStore(); const a = s.agentOf(id);
  return <span className="inline-flex items-center gap-1"><AgentAvatar agent={a} size="xs" />{a.name}</span>;
}

function UserTurn({ m, agent, showTarget }: { m: UserMessage; agent: Agent; showTarget: boolean }) {
  const s = useStore();
  return (
    <div className="flex flex-col items-end gap-1">
      {showTarget && <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {m.kind === 'race' ? <>Race between {m.target.split(',').map((id) => <AgentAvatarName key={id} id={id} />)}</>
          : <>{m.team ? `${m.team.role === 'member' ? 'Question' : `To the ${m.team.role}`},` : m.kind === 'research' ? 'Research request for' : m.kind === 'plan' ? 'Plan request for' : m.kind === 'implement' ? 'Run plan with' : 'To'} <AgentAvatar agent={agent} size="xs" /> {agent.name}</>}
      </span>}
      {!!m.attachments?.length && <ChatAttachments files={m.attachments} />}
      {s.codeLayout && <ActivityTime ts={m.ts} />}
      <Bubble align="end" variant={s.codeLayout ? 'outline' : 'secondary'} className={cn('max-w-[85%]', s.codeLayout && 'w-full max-w-full')}>
        <BubbleContent className={cn('text-[0.9375rem] whitespace-pre-wrap', s.codeLayout && 'w-full rounded-md')}>{m.text}</BubbleContent>
      </Bubble>
    </div>
  );
}

/** A quiet conversation column; each response retains its assistant identity. */
export function Conversation() {
  const s = useStore(); const msgs = s.thread?.messages ?? [];
  const multipleTargets = new Set(msgs.filter((message) => message.role === 'user').map((message) => message.target)).size > 1;
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation" className="overflow-x-hidden">
          <MessageScrollerContent className={cn('mx-auto w-full max-w-3xl gap-0 px-4 py-6 sm:px-6', s.codeLayout && 'py-5 sm:px-4')}>
            {(() => { let lastUser: UserMessage | undefined; return msgs.map((m: Msg) => {
              if (m.role === 'user') lastUser = m;
              const agent = s.agentOf(m.role === 'user' ? m.target.split(',')[0] : m.agent);
              const prompt = m.role === 'assistant' ? lastUser : undefined;
              const race = m.role === 'assistant' && m.kind === 'race';
              return (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'} className={cn('group/turn relative pb-8', s.codeLayout && 'pb-6')}>
                  {m.role === 'user' ? <UserTurn m={m} agent={agent} showTarget={!s.codeLayout || multipleTargets || !!m.team || (!!m.kind && m.kind !== 'chat')} /> : race ? <RaceTurn m={m} /> : <AgentTurn m={m} agent={agent} prompt={prompt} />}
                </MessageScrollerItem>
              );
            }); })()}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
