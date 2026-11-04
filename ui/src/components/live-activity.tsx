import * as React from 'react';
import { Activity, ArrowLeft, CircleAlert, CircleCheck, GitBranch, Search, MessageSquare, Plus, ShieldQuestion, Square, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { activityCounts, finishedActivity, isWorkerBusy } from '@/lib/collaboration-view.mjs';
import { FileTypeIcon } from '@/components/file-type-icon';
import { LineChangeCount } from '@/components/line-change-count';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { FileDiff } from '@/components/file-diff';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { NeedsYou } from '@/components/needs-you';
import { useStore } from '@/store';
import type { ActivityEntry, ActivityWorker, AgentMessage, Thread } from '@/types';

const KIND: Record<ActivityEntry['kind'], string> = { turn: 'Conversation', team: 'Team', race: 'Race', manager: 'Manager' };
const STATE: Record<string, string> = { working: 'Working', testing: 'Testing', merging: 'Merging', waiting: 'Waiting', done: 'Done', failed: 'Failed', skipped: 'Skipped', stopped: 'Stopped' };
const elapsed = (from?: number, until = Date.now()) => { if (!from) return ''; const s = Math.max(0, Math.round((until - from) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const project = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

type Pick = { threadId: string; worker: ActivityWorker; rel: string; live: boolean };
type Finished = ActivityEntry & { endedAt: number };

function StateIcon({ state }: { state: ActivityWorker['state'] }) {
  if (state === 'working' || state === 'testing' || state === 'merging') return <Spinner className="size-3.5 text-brand" aria-label={STATE[state]} />;
  if (state === 'failed') return <CircleAlert className="size-3.5 text-destructive" aria-label="Failed" />;
  if (state === 'done') return <CircleCheck className="size-3.5 text-success" aria-label="Done" />;
  return <span className="size-3.5 rounded-full border border-dashed" aria-label={STATE[state] || state} />;
}

// One file's diff for one worker. A turn in the project refreshes while the agent works; a worker in its
// own copy (race, manager) shows its diff once it has finished.
function LiveDiff({ pick }: { pick: Pick }) {
  const s = useStore(); const [diff, setDiff] = React.useState<string | null>(null); const [error, setError] = React.useState(''); const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let alive = true; let timer = 0;
    const load = async () => {
      try {
        let text = '';
        if (pick.worker.role === 'candidate' || pick.worker.taskId) {
          const t = await s.hub.call<Thread | null>('thread', pick.threadId);
          const m = t?.messages.find((x) => x.id === pick.worker.messageId) as AgentMessage | undefined;
          const whole = pick.worker.taskId ? (m as AgentMessage & { manager?: { tasks: { id: string; diff?: string }[] } })?.manager?.tasks.find((x) => x.id === pick.worker.taskId)?.diff : m?.race?.candidates.find((c) => c.agent === pick.worker.agent)?.diff;
          text = (whole || '').split(/(?=^diff --git )/m).find((part) => part.startsWith(`diff --git a/${pick.rel} `) || part.includes(` b/${pick.rel}\n`)) || '';
          if (!text) text = pick.live ? '' : 'No diff for this file.';
        } else if (pick.worker.messageId) {
          text = await s.hub.call<string>('turnDiff', pick.threadId, pick.worker.messageId, pick.rel);
        }
        if (alive) { setDiff(text); setError(''); }
      } catch { if (alive) setError('Could not load this change.'); }
      if (alive && pick.live) timer = window.setTimeout(load, 1500);
    };
    setDiff(null); setError(''); load();
    return () => { alive = false; clearTimeout(timer); };
  }, [s.hub, pick.threadId, pick.worker.key, pick.rel, pick.live, retry]);
  if (error) return <div role="alert" className="flex items-center gap-2 p-4 text-xs"><span className="flex-1">{error}</span><Button size="xs" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>;
  if (diff == null) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading the change…</div>;
  if (!diff.trim()) return <p className="p-4 text-sm text-muted-foreground">{pick.live ? 'This agent works in its own copy. Its changes show here when it finishes.' : 'No changes in this file yet.'}</p>;
  return <><p className="truncate font-mono text-xs" title={pick.rel}>{pick.rel}</p><FileDiff diff={diff} /></>;
}

const ROLE: Record<string, string> = { planner: 'Planner', builder: 'Builder', reviewer: 'Reviewer', synthesizer: 'Summarizer', member: 'Member', worker: 'Worker', candidate: 'Candidate', manager: 'Lead agent' };
function WorkerRow({ entry, worker, pick, onPick, onOpen }: { entry: ActivityEntry; worker: ActivityWorker; pick: Pick | null; onPick: (p: Pick) => void; onOpen: () => void }) {
  const s = useStore(); const agent = s.agentOf(worker.agent); const [expanded, setExpanded] = React.useState(false);
  const busy = isWorkerBusy(worker);
  const dependencies = (worker.dependsOn || []).filter((dependency) => dependency.state !== 'done');
  return <li className="min-w-0 rounded-lg border bg-background/40">
    <div className="flex min-w-0 items-start gap-2 px-3 pt-3">
      <AgentAvatar agent={agent} size="sm" />
      <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="truncate text-[13px] font-medium">{agent.name}</span><span className="text-[11px] text-muted-foreground">{worker.role && (ROLE[worker.role] || worker.role)}</span></div>{worker.task && <p className="mt-1 text-[13px] leading-5">{worker.task}</p>}</div>
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px]', worker.attention ? 'bg-warning/10 text-warning' : worker.state === 'failed' ? 'bg-destructive/10 text-destructive' : worker.state === 'done' ? 'bg-success/10 text-success' : 'bg-muted/60 text-muted-foreground')}>{worker.attention ? <ShieldQuestion className="size-3.5" /> : <StateIcon state={worker.state} />}{worker.attention ? 'Needs you' : STATE[worker.state] || worker.state}</span>
    </div>
    <div className="min-w-0 px-3 pt-2 pb-2">
      {worker.doing && <p className="truncate text-xs leading-5 text-muted-foreground" title={worker.doing}>{worker.doing}</p>}
      {dependencies.length > 0 && <p className="text-xs leading-5 text-muted-foreground">{dependencies.some((item) => ['failed', 'skipped'].includes(item.state)) ? 'Blocked by' : 'After'} {dependencies.map((item) => item.title).join(', ')}</p>}
      {worker.note && <p className={cn('line-clamp-2 text-xs leading-5', worker.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')} title={worker.note}>{worker.note}</p>}
      {worker.branch && <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title={worker.branch}><GitBranch className="size-3 shrink-0" /><span className="truncate">{worker.branch}</span></p>}
      {!!worker.files.length && <ul className="mt-2 space-y-0.5" aria-label={`Files changed by ${agent.name}`}>{worker.files.slice(0, expanded ? 64 : 3).map((file) => <li key={file.rel}><button type="button" onClick={() => onPick({ threadId: entry.threadId, worker, rel: file.rel, live: busy })} title={file.rel} className={cn('flex min-h-7 w-full min-w-0 items-center gap-2 rounded px-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11', pick?.worker.key === worker.key && pick.rel === file.rel && 'bg-muted')}><FileTypeIcon path={file.rel} /><span className="min-w-0 flex-1 truncate">{file.rel}</span><LineChangeCount {...file} /></button></li>)}</ul>}
      {worker.files.length > 3 && <Button size="xs" variant="ghost" className="mt-1 text-xs" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer files' : `Show ${worker.files.length - 3} more files`}</Button>}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2"><Button size="xs" variant={worker.attention ? 'secondary' : 'ghost'} onClick={onOpen}><MessageSquare />{worker.attention ? 'Review approval' : 'Open chat'}</Button>{worker.tests && !['pending', 'skipped'].includes(worker.tests) && <span className={cn('ml-auto text-[11px]', worker.tests === 'failed' ? 'text-destructive' : worker.tests === 'passed' ? 'text-success' : 'text-muted-foreground')}>Checks {worker.tests}</span>}</div>
    </div>
  </li>;
}

/**
 * The live view: every agent at work across conversations, teams, races and managed runs, what it is doing,
 * the files it changed and their diffs as they change. Opens from the "agents working" pill.
 */
export function LiveActivity() {
  const s = useStore();
  const [items, setItems] = React.useState<ActivityEntry[]>([]);
  const [finished, setFinished] = React.useState<Finished[]>([]);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'running' | 'waiting' | 'recent'>('all');
  const [pick, setPick] = React.useState<Pick | null>(null);
  const [, tick] = React.useState(0);
  const previous = React.useRef<ActivityEntry[]>([]);
  const [error, setError] = React.useState(''); const [retry, setRetry] = React.useState(0);
  const [stopping, setStopping] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true; let streamed = false;
    const take = (next: ActivityEntry[]) => {
      if (!alive) return;
      const ended = previous.current.filter((entry) => !next.some((item) => item.threadId === entry.threadId));
      previous.current = next; setItems(next); setError('');
      if (ended.length) {
        setFinished((saved) => [...ended.map((entry) => ({ ...finishedActivity(entry, null), endedAt: Date.now() })), ...saved.filter((item) => !ended.some((entry) => entry.threadId === item.threadId))].slice(0, 8));
        for (const entry of ended) void s.hub.call<Thread | null>('thread', entry.threadId).then((thread) => { if (alive) setFinished((saved) => saved.map((item) => item.threadId === entry.threadId && !previous.current.some((live) => live.threadId === entry.threadId) ? finishedActivity(item, thread) : item)); }).catch(() => {});
      }
    };
    s.hub.call<ActivityEntry[]>('activity').then((entries) => { if (!streamed) take(entries || []); }).catch(() => { if (alive && !streamed) setError('Couldn’t load agent activity.'); });
    const off = s.hub.on('activity', (entries) => { streamed = true; take(entries); });
    const show = () => setOpen(true); // other places can open the view with this event
    window.addEventListener('tributary:live', show);
    return () => { alive = false; window.removeEventListener('tributary:live', show); if (typeof off === 'function') off(); };
  }, [s.hub, retry]);
  // Elapsed times tick while the view or the pill is showing.
  React.useEffect(() => { if (!items.length && !open) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [items.length, open]);
  // A picked file follows its worker: live while it works, final once it is done.
  React.useEffect(() => {
    if (!pick) return;
    const w = [...items, ...finished].flatMap((e) => e.workers).find((x) => x.key === pick.worker.key);
    const live = !!w && isWorkerBusy(w) && items.some((entry) => entry.workers.some((worker) => worker.key === w.key));
    if (live !== pick.live || w && JSON.stringify(w) !== JSON.stringify(pick.worker)) setPick({ ...pick, worker: w || pick.worker, live });
  }, [items, finished, pick]);

  const counts = activityCounts(items);
  const recent = finished.filter((entry) => Date.now() - entry.endedAt < 10 * 60 * 1000 && !items.some((live) => live.threadId === entry.threadId));
  const matches = (entry: ActivityEntry) => `${entry.title} ${entry.project} ${entry.workers.map((worker) => s.agentOf(worker.agent).name + ' ' + (worker.task || '') + ' ' + worker.files.map((file) => file.rel).join(' ')).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase());
  const shown = filter === 'recent' ? [] : items.filter(matches).filter((entry) => filter === 'running' ? entry.workers.some(isWorkerBusy) : filter === 'waiting' ? entry.workers.some((worker) => worker.state === 'waiting' || worker.attention) : true);
  const shownRecent = filter === 'running' || filter === 'waiting' ? [] : recent.filter(matches);
  const openThread = (id: string) => { setOpen(false); void s.openThread(id).catch((error: Error) => toast.error(error.message)); };
  const startTeam = () => { setOpen(false); s.setTeamOpen(true); };
  const stop = async (id: string) => { setStopping(id); try { await s.hub.call('stop', id); } catch (error) { toast.error((error as Error).message); } finally { setStopping(null); } };
  const entryCard = (entry: ActivityEntry, ended = false) => {
    const progress = activityCounts([entry]);
    return <section key={entry.threadId} aria-label={entry.title} className="min-w-0 space-y-2">
      <header className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><button type="button" className="max-w-full truncate rounded text-left text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openThread(entry.threadId)}>{entry.title}</button><p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><span className="truncate">{project(entry.project)}</span><span>{entry.recipeName || KIND[entry.kind]}</span>{entry.startedAt && <span className="tabular-nums">{elapsed(entry.startedAt, ended ? (entry as Finished).endedAt : undefined)}</span>}{entry.parentThreadId && <button className="hover:underline" onClick={() => openThread(entry.parentThreadId!)}>Parent chat</button>}</p></div>{!ended && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" disabled={stopping === entry.threadId} aria-label={`Stop task: ${entry.title}`} onClick={() => void stop(entry.threadId)}><Square className="size-3.5" /></Button></TooltipTrigger><TooltipContent>Stop this task and its agents</TooltipContent></Tooltip>}</header>
      {progress.total > 1 && <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><div role="progressbar" aria-label="Completed agent tasks" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-1 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-success" style={{ width: `${progress.done / progress.total * 100}%` }} /></div><span className="shrink-0 tabular-nums">{progress.done}/{progress.total} done</span></div>}
      <ul className="space-y-2">{entry.workers.map((worker) => <WorkerRow key={worker.key} entry={entry} worker={worker} pick={pick} onPick={setPick} onOpen={() => openThread(entry.threadId)} />)}{!entry.workers.length && <li className="px-1 py-2 text-xs text-muted-foreground">Preparing the next step…</li>}</ul>
    </section>;
  };
  return <>
    {!open && <NeedsYou />}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className={cn('w-full gap-0 p-0 data-[side=right]:sm:max-w-none', pick ? 'data-[side=right]:w-[min(1120px,100vw)]' : 'data-[side=right]:w-[min(520px,100vw)]')}>
      <SheetHeader className="gap-1 border-b pr-12"><SheetTitle className="flex items-center gap-2"><Users className="size-4" /> Agent activity</SheetTitle><SheetDescription className="text-xs">{counts.running ? `${counts.running} working` : 'No agents working'}{counts.attention ? ` · ${counts.attention} need approval` : ''}{counts.waiting ? ` · ${counts.waiting} waiting` : ''}</SheetDescription></SheetHeader>
      <div className={cn('border-b px-4 py-3', pick && 'max-md:hidden')}><div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Search activity" placeholder="Find a task, agent or file…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div><Button size="sm" variant="outline" disabled={!s.project} onClick={startTeam}><Plus />New team</Button></div><div role="group" aria-label="Activity filter" className="mt-2 flex flex-wrap gap-1">{(['all', 'running', 'waiting', 'recent'] as const).map((value) => <Button key={value} size="xs" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'running' ? `Working ${counts.running}` : value === 'waiting' ? `Waiting ${counts.waiting + counts.attention}` : `Recent ${recent.length}`}</Button>)}<span className="ml-auto self-center text-[11px] text-muted-foreground">{counts.files} files</span></div></div>
      {error && <div role="alert" className="flex items-center gap-2 border-b p-3 text-xs"><span className="flex-1">{error}</span><Button size="xs" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>}
      <div className={cn('grid min-h-0 flex-1', pick && 'md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]')}>
        <div className={cn('min-h-0 overflow-y-auto p-4', pick && 'hidden md:block md:border-r')}>
          {!shown.length && !shownRecent.length && <Empty className="min-h-56 border-0"><EmptyHeader><EmptyMedia variant="icon"><Activity /></EmptyMedia><EmptyTitle className="text-sm">{query ? 'No matching activity' : filter === 'waiting' ? 'No tasks waiting' : filter === 'recent' ? 'No recent runs' : 'Ready to collaborate'}</EmptyTitle><EmptyDescription className="text-xs">{query ? 'Try another task, agent or file.' : 'Create a team or send a task from chat.'}</EmptyDescription></EmptyHeader>{!query && <Button size="sm" variant="outline" disabled={!s.project} onClick={startTeam}><Plus />Create agent team</Button>}</Empty>}
          <div className="space-y-5">{shown.map((entry) => entryCard(entry))}{!!shownRecent.length && <section aria-label="Finished recently" className="space-y-3"><h3 className="text-[11px] font-medium text-muted-foreground">FINISHED RECENTLY</h3>{shownRecent.map((entry) => entryCard(entry, true))}</section>}</div>
        </div>
        {pick && <div className="flex min-h-0 min-w-0 flex-col"><div className="flex h-10 shrink-0 items-center gap-2 border-b px-3"><Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to agent activity" onClick={() => setPick(null)}><ArrowLeft /></Button><AgentAvatar agent={s.agentOf(pick.worker.agent)} size="xs" /><span className="min-w-0 flex-1 truncate text-xs">{s.agentOf(pick.worker.agent).name}{pick.live ? ' · Live changes' : ' · Saved changes'}</span><Button variant="ghost" size="icon-sm" aria-label="Close change preview" onClick={() => setPick(null)}><X /></Button></div><div className="min-h-0 overflow-auto p-3"><LiveDiff pick={pick} /></div></div>}
      </div>
    </SheetContent></Sheet>
  </>;
}
