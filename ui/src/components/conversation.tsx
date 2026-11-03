import * as React from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, BookmarkPlus, Brain, Check, CircleCheck, CircleX, Copy, FileCode2, FileText, Flag, Globe, History, Info, ListChecks, Play, Repeat2, RotateCcw, Search, SquareTerminal, Wrench,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { activitySummary, changeCode, duration, toolTarget, toolVerb } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Agent, AgentMessage, Message as Msg, RaceCandidate, Tool, UserMessage } from '@/types';

const MODE_LABEL = { read: 'Read-only', edit: 'Edit files', full: 'Full auto' } as const;
const HANDOFF = { join: 'Joined with a summary of this thread', 'catch-up': 'Caught up on the other agents' } as Record<string, string>;

function toolIcon(t: Tool) {
  const v = toolVerb(t);
  if (t.status === 'error') return <AlertCircle />;
  return v === 'Ran' ? <SquareTerminal /> : v === 'Edited' ? <FileCode2 /> : v === 'Read' ? <FileText /> : v === 'Searched' ? <Search /> : v === 'Browsed' ? <Globe /> : <Wrench />;
}

function Step({ t }: { t: Tool }) {
  const s = useStore();
  const line = (
    <TraceLine status={t.status === 'running' ? 'running' : t.status === 'error' ? 'error' : undefined}>
      <TraceIcon>{t.status === 'running' ? <Spinner /> : toolIcon(t)}</TraceIcon>
      <TraceTitle>{toolVerb(t)}</TraceTitle>
      <TraceDescription className="font-mono text-[12.5px]">{toolTarget(t, s.workdir)}</TraceDescription>
    </TraceLine>
  );
  if (!t.output) return <div>{line}</div>;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="py-1.5 pl-6"><HighlightedCode code={t.output} language={/^(shell|bash|run_shell_command)$/i.test(t.name) ? 'ansi' : 'text'} wrap /></div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function Activity({ m }: { m: AgentMessage }) {
  const live = m.ok == null;
  const [open, setOpen] = React.useState<boolean | null>(null);
  const isOpen = open ?? live;
  const steps = m.tools || [];
  if (!steps.length && !m.thinking && !m.plan) {
    return live && !m.text ? <Trace><TraceLine status="running"><TraceIcon><Spinner /></TraceIcon><TraceTitle>Starting</TraceTitle></TraceLine></Trace> : null;
  }
  const lastRun = [...steps].reverse().find((t) => t.status === 'running');
  return (
    <Trace>
      <TraceCollapsible open={isOpen} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? 'running' : undefined}>
            <TraceIcon>{live ? <Spinner /> : <ListChecks />}</TraceIcon>
            <TraceTitle>{live ? 'Working' : activitySummary(m) || 'Activity'}</TraceTitle>
            {live && lastRun && <TraceDescription className="font-mono text-[12.5px]">{toolTarget(lastRun, null)}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="ml-2 flex flex-col gap-1.5 border-l py-1.5 pl-4">
            {m.thinking && (
              <TraceCollapsible>
                <TraceCollapsibleTrigger><TraceLine><TraceIcon><Brain /></TraceIcon><TraceTitle>Thinking</TraceTitle></TraceLine></TraceCollapsibleTrigger>
                <TraceCollapsibleContent><p className="max-h-60 overflow-auto py-1 pl-6 text-sm whitespace-pre-wrap text-muted-foreground">{m.thinking.slice(-4000)}</p></TraceCollapsibleContent>
              </TraceCollapsible>
            )}
            {m.plan && (
              <ul className="flex flex-col gap-1 py-0.5 text-sm" aria-label="Agent plan">
                {m.plan.map((p, i) => (
                  <li key={i} className={cn('flex items-start gap-2', p.done && 'text-muted-foreground line-through')}>
                    <Checkbox checked={!!p.done} disabled aria-hidden tabIndex={-1} className="mt-0.5 disabled:cursor-default disabled:opacity-100" /><span className="sr-only">{p.done ? 'Done: ' : 'To do: '}</span>{p.text}
                  </li>
                ))}
              </ul>
            )}
            {steps.map((t, i) => <Step key={t.id ?? i} t={t} />)}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function FilesChanged({ m }: { m: AgentMessage }) {
  const s = useStore(); const files = (m.files || []).filter((f) => !f.external);
  if (!files.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <FileCode2 className="size-4 text-muted-foreground" />
        <span className="font-medium">{files.length} file{files.length > 1 ? 's' : ''} changed</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => s.openReview(files[0].rel)}>Review</Button>
      </div>
      <ul>
        {files.slice(0, 8).map((f) => (
          <li key={f.path}>
            <div className="group/row flex items-center hover:bg-muted/60">
              <button className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left text-sm" onClick={() => s.openReview(f.rel)} title="Show the diff">
                <ChangeCode code={changeCode(f.change)} />
                <span className="truncate font-mono text-[12.5px]">{f.rel}</span>
              </button>
              <button className="mr-2 rounded p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100" onClick={() => s.openFile(f.rel)} aria-label={`Edit ${f.rel}`}><FileCode2 className="size-3.5" /></button>
            </div>
          </li>
        ))}
        {files.length > 8 && <li><button className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60" onClick={() => s.openReview(null)}>{files.length - 8} more in Review</button></li>}
      </ul>
    </div>
  );
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
          <DropdownMenuItem key={a.id} disabled={s.running} onClick={() => { s.setAgentId(a.id); s.hub.call('send', { threadId: s.thread!.id, agentId: a.id, text: prompt.text, mode: m.mode, gatewayId: null }).catch((e: Error) => toast.error(e.message)); }}>
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

function RunPlan({ m }: { m: AgentMessage }) {
  const s = useStore();
  if (m.kind !== 'plan' || !m.ok || !m.text) return null;
  const run = (agentId: string) => {
    s.setAgentId(agentId); if (s.mode === 'read') s.setMode('edit');
    s.hub.call('send', { threadId: s.thread!.id, agentId, text: '', mode: s.mode === 'read' ? 'edit' : s.mode, gatewayId: null, planFrom: m.id }).catch((e: Error) => toast.error(e.message));
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
  if (m.ok !== false || !prompt || m.kind === 'race') return null;
  return (
    <Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon-xs" aria-label="Try again" disabled={s.running}
        onClick={() => s.hub.call('send', { threadId: s.thread!.id, agentId: m.agent, text: prompt.text, mode: m.mode, gatewayId: null, plan: m.kind === 'plan' }).catch((e: Error) => toast.error(e.message))}><RotateCcw /></Button>
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
  const applied = m.race?.applied; const winner = applied === c.agent;
  const t = TESTS[c.tests ?? 'skipped'] ?? TESTS.skipped;
  return (
    <div className={cn('flex min-w-0 flex-col rounded-xl border bg-card', winner && 'border-success ring-1 ring-success')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <AgentAvatar agent={a} size="sm" /><span className="min-w-0 truncate font-medium">{a.name}</span>
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
          <AgentAvatar agent={agent} size="md" />
          <span className="font-semibold">{agent.name}</span>
          {m.team && <Badge variant="secondary" className="capitalize">{m.team.role === 'member' ? 'Answering' : m.team.role}</Badge>}
          {m.kind === 'plan' ? <Badge variant="secondary">Plan</Badge> : <Badge variant="outline" className="font-normal text-muted-foreground">{MODE_LABEL[m.mode] ?? m.mode}</Badge>}
          {m.gateway && <Badge variant="outline" className="border-brand/30 font-normal text-brand">via {m.gateway}</Badge>}
          {m.handoff && HANDOFF[m.handoff] && <span className="text-xs text-muted-foreground">{HANDOFF[m.handoff]}</span>}
        </MessageHeader>
        <Activity m={m} />
        {m.text && <div className={cn(live && 'after:ml-1 after:inline-block after:size-2 after:animate-pulse after:rounded-full after:bg-foreground/70')}><Markdown text={m.text} /></div>}
        {(m.notices || []).map((n, i) => <p key={i} className="flex items-center gap-1.5 text-sm text-warning"><Info className="size-3.5" /> {n}</p>)}
        {m.error && <Alert variant="destructive"><AlertCircle /><AlertDescription className="whitespace-pre-wrap">{m.error}</AlertDescription></Alert>}
        <FilesChanged m={m} />
        <RunPlan m={m} />
        {!live && (
          <MessageFooter className="flex items-center gap-0.5 text-xs text-muted-foreground">
            {m.ok === false && <span className="mr-2 font-medium text-destructive">Failed</span>}
            {m.durationMs ? <span className="mr-3 tabular-nums">{duration(m.durationMs)}</span> : null}
            {m.costUsd ? <span className="mr-3 tabular-nums">${m.costUsd.toFixed(3)}</span> : null}
            {tokens ? <span className="mr-3 tabular-nums">{tokens.toLocaleString()} tokens</span> : null}
            <span className="flex items-center opacity-70 transition-opacity group-hover/turn:opacity-100">
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

function UserTurn({ m, agent }: { m: UserMessage; agent: Agent }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {m.kind === 'race' ? <>Race between {m.target.split(',').map((id) => <AgentAvatarName key={id} id={id} />)}</>
          : <>{m.team ? `${m.team.role === 'member' ? 'Question' : `To the ${m.team.role}`},` : m.kind === 'plan' ? 'Plan request for' : m.kind === 'implement' ? 'Run plan with' : 'To'} <AgentAvatar agent={agent} size="xs" /> {agent.name}</>}
      </span>
      <Bubble align="end" variant="secondary" className="max-w-[85%]">
        <BubbleContent className="text-[0.9375rem] whitespace-pre-wrap">{m.text}</BubbleContent>
      </Bubble>
    </div>
  );
}

/** The thread as one stream: a colored line beside each turn shows which agent was working. */
export function Conversation() {
  const s = useStore(); const msgs = s.thread?.messages ?? [];
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-0 px-4 py-6 sm:px-6">
            {(() => { let lastUser: UserMessage | undefined; return msgs.map((m: Msg) => {
              if (m.role === 'user') lastUser = m;
              const agent = s.agentOf(m.role === 'user' ? m.target.split(',')[0] : m.agent);
              const prompt = m.role === 'assistant' ? lastUser : undefined;
              const race = m.role === 'assistant' && m.kind === 'race';
              return (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === 'user'} className="group/turn relative pb-7 pl-6">
                  <span aria-hidden className="absolute top-0 bottom-0 left-[7px] w-[2px] rounded-full" style={{ background: race ? 'linear-gradient(var(--brand), var(--brand-2))' : m.role === 'assistant' ? agent.color : 'var(--border)', opacity: m.role === 'assistant' ? 0.9 : 1 }} />
                  {m.role === 'assistant' && <span aria-hidden className="absolute top-1.5 left-[3px] size-[10px] rounded-full border-2 border-background" style={{ background: race ? 'var(--brand)' : agent.color }} />}
                  {m.role === 'user' ? <UserTurn m={m} agent={agent} /> : race ? <RaceTurn m={m} /> : <AgentTurn m={m} agent={agent} prompt={prompt} />}
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
