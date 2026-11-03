import * as React from 'react';
import { Activity, CircleAlert, CircleCheck, FileCode2, GitBranch, Radio } from 'lucide-react';
import { AgentAvatar } from '@/components/agent-avatar';
import { HighlightedCode } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { ActivityEntry, ActivityWorker, AgentMessage, Thread } from '@/types';

const KIND: Record<ActivityEntry['kind'], string> = { turn: 'Conversation', team: 'Team', race: 'Race', manager: 'Manager' };
const STATE: Record<string, string> = { working: 'Working', testing: 'Testing', merging: 'Merging', waiting: 'Waiting', done: 'Done', failed: 'Failed', skipped: 'Skipped' };
const elapsed = (from?: number) => { if (!from) return ''; const s = Math.max(0, Math.round((Date.now() - from) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
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
  const s = useStore(); const [diff, setDiff] = React.useState<string | null>(null);
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
        if (alive) setDiff(text);
      } catch (e) { if (alive) setDiff(`Could not load this change: ${(e as Error).message}`); }
      if (alive && pick.live) timer = window.setTimeout(load, 1500);
    };
    setDiff(null); load();
    return () => { alive = false; clearTimeout(timer); };
  }, [s.hub, pick]);
  if (diff == null) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading the change…</div>;
  if (!diff.trim()) return <p className="p-4 text-sm text-muted-foreground">{pick.live ? 'This agent works in its own copy. Its changes show here when it finishes.' : 'No changes in this file yet.'}</p>;
  return <HighlightedCode code={diff} language="diff" title={<span className="font-mono text-xs">{pick.rel}</span>} />;
}

function WorkerRow({ entry, worker, pick, onPick }: { entry: ActivityEntry; worker: ActivityWorker; pick: Pick | null; onPick: (p: Pick) => void }) {
  const s = useStore(); const agent = s.agentOf(worker.agent);
  const busy = worker.state === 'working' || worker.state === 'testing' || worker.state === 'merging';
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border bg-background/60 p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <AgentAvatar agent={agent} size="sm" />
        <span className="truncate text-sm font-medium">{agent.name}</span>
        {worker.role && <Badge variant="outline" className="max-w-48 truncate font-normal">{worker.role}</Badge>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><StateIcon state={worker.state} />{STATE[worker.state] || worker.state}{worker.tests && worker.tests !== 'skipped' && worker.tests !== 'pending' ? `, tests ${worker.tests}` : ''}</span>
      </div>
      {worker.doing && <p className={cn('truncate font-mono text-xs', busy ? 'text-foreground' : 'text-muted-foreground')} title={worker.doing}>{busy && <span className="mr-1 text-brand">›</span>}{worker.doing}</p>}
      {worker.branch && <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground"><GitBranch className="size-3" />{worker.branch}</p>}
      {worker.files.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {worker.files.slice(0, 12).map((f) => {
            const on = pick?.worker.key === worker.key && pick.rel === f.rel;
            return (
              <Button key={f.rel} size="xs" variant={on ? 'secondary' : 'outline'} className="max-w-full font-mono font-normal" title={f.rel}
                onClick={() => onPick({ threadId: entry.threadId, worker, rel: f.rel, live: busy })}>
                <FileCode2 /><span className="truncate">{f.rel}</span>
              </Button>
            );
          })}
          {worker.files.length > 12 && <span className="self-center text-xs text-muted-foreground">+{worker.files.length - 12} more</span>}
        </div>
      )}
    </li>
  );
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
  const [pick, setPick] = React.useState<Pick | null>(null);
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    const take = (next: ActivityEntry[]) => setItems((prev) => {
      const ended = prev.filter((p) => !next.some((x) => x.threadId === p.threadId));
      if (ended.length) setFinished((f) => [...ended.map((e) => ({ ...e, endedAt: Date.now() })), ...f.filter((x) => !ended.some((e) => e.threadId === x.threadId))].slice(0, 8));
      return next;
    });
    s.hub.call<ActivityEntry[]>('activity').then((a) => { if (alive) take(a || []); }).catch(() => {});
    const off = s.hub.on('activity', take);
    const show = () => setOpen(true); // other places can open the view with this event
    window.addEventListener('tributary:live', show);
    return () => { alive = false; window.removeEventListener('tributary:live', show); if (typeof off === 'function') off(); };
  }, [s.hub]);
  // Elapsed times tick while the view or the pill is showing.
  React.useEffect(() => { if (!items.length) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [items.length]);
  // A picked file follows its worker: live while it works, final once it is done.
  React.useEffect(() => {
    if (!pick) return;
    const w = items.flatMap((e) => e.workers).find((x) => x.key === pick.worker.key);
    const live = !!w && (w.state === 'working' || w.state === 'testing' || w.state === 'merging');
    if (live !== pick.live) setPick({ ...pick, worker: w || pick.worker, live });
  }, [items, pick]);

  const workers = items.flatMap((e) => e.workers);
  const busy = workers.filter((w) => w.state === 'working' || w.state === 'testing' || w.state === 'merging');
  const recent = finished.filter((f) => Date.now() - f.endedAt < 10 * 60 * 1000);
  const openThread = (id: string) => { setOpen(false); s.openThread(id); };

  return (
    <>
      {(busy.length > 0 || (recent.length > 0 && !open)) && !open && (
        <Button variant="outline" onClick={() => setOpen(true)} aria-label={busy.length ? `${busy.length} agents working. Open the live view` : 'Open the live view'}
          className="fixed right-4 bottom-24 z-40 h-9 gap-2 rounded-full bg-popover pr-3 pl-1.5 shadow-md">
          <span className="flex -space-x-1">{[...new Set((busy.length ? busy : recent.flatMap((r) => r.workers)).map((w) => w.agent))].slice(0, 4).map((id) => <AgentAvatar key={id} agent={s.agentOf(id)} size="sm" className="ring-2 ring-popover" />)}</span>
          {busy.length ? <><Radio className="text-brand" />{busy.length} working</> : 'Recent agent work'}
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-[min(1040px,100vw)] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2"><Activity className="size-4" /> Live activity</SheetTitle>
            <SheetDescription>{busy.length ? `${busy.length} agent${busy.length === 1 ? '' : 's'} working across ${items.length} conversation${items.length === 1 ? '' : 's'}. Pick a file to watch its changes.` : 'No agent is working right now.'}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-h-0 overflow-y-auto border-b p-4 md:border-r md:border-b-0">
              {!items.length && !recent.length && (
                <Empty className="border"><EmptyHeader><EmptyMedia variant="icon"><Activity /></EmptyMedia><EmptyTitle>Nothing running</EmptyTitle>
                  <EmptyDescription>Agents working in any conversation, team, race or managed run show up here as they work.</EmptyDescription></EmptyHeader></Empty>
              )}
              <div className="flex flex-col gap-4">
                {items.map((e) => (
                  <section key={e.threadId} aria-label={e.title} className="flex flex-col gap-2">
                    <header className="flex min-w-0 items-center gap-2">
                      <button className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => openThread(e.threadId)}>{e.title}</button>
                      <Badge variant="secondary" className="shrink-0">{e.kind === 'team' ? e.recipeName || 'Team' : KIND[e.kind]}</Badge>
                      {e.phase && <Badge variant="outline" className="shrink-0 font-normal">{e.phase}</Badge>}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{project(e.project)} · {elapsed(e.startedAt)}</span>
                    </header>
                    <ul className="flex flex-col gap-1.5">
                      {e.workers.map((w) => <WorkerRow key={w.key} entry={e} worker={w} pick={pick} onPick={setPick} />)}
                      {!e.workers.length && <li className="text-xs text-muted-foreground">Between steps…</li>}
                    </ul>
                  </section>
                ))}
                {recent.length > 0 && (
                  <section aria-label="Finished recently" className="flex flex-col gap-1.5">
                    <h3 className="text-xs font-medium text-muted-foreground">Finished recently</h3>
                    {recent.map((f) => {
                      const status = (s.threadsBy[f.project] || []).find((t) => t.id === f.threadId)?.status;
                      const changed = new Set(f.workers.flatMap((w) => w.files.map((x) => x.rel))).size;
                      return (
                        <button key={f.threadId} onClick={() => openThread(f.threadId)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                          {status === 'failed' ? <CircleAlert className="size-3.5 shrink-0 text-destructive" /> : <CircleCheck className="size-3.5 shrink-0 text-success" />}
                          <span className="min-w-0 flex-1 truncate">{f.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{changed ? `${changed} file${changed === 1 ? '' : 's'}` : KIND[f.kind]}</span>
                        </button>
                      );
                    })}
                  </section>
                )}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              {pick ? (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><AgentAvatar agent={s.agentOf(pick.worker.agent)} size="xs" />{s.agentOf(pick.worker.agent).name}{pick.live && <><Spinner className="size-3" /> updating live</>}</p>
                  <LiveDiff pick={pick} />
                </div>
              ) : <p className="p-2 text-sm text-muted-foreground">Pick a changed file on the left to see its diff. A file an agent is editing in the project updates here as it changes.</p>}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
