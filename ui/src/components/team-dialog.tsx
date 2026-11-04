import * as React from 'react';
import { toast } from 'sonner';
import { Check, Circle, CircleCheck, CircleX, Flag, GitCompareArrows, MessagesSquare, ShieldCheck, Users, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AgentAvatar } from '@/components/agent-avatar';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Thread } from '@/types';

type Kind = 'race' | 'manager' | 'plan-build-review' | 'build-review' | 'council';
const KINDS: { id: Kind; name: string; evidence: string; description: string }[] = [
  { id: 'race', name: 'Race', evidence: 'Separate working copies', description: 'Compare attempts, run checks and apply one result.' },
  { id: 'manager', name: 'Lead & workers', evidence: 'Parallel workers in separate copies', description: 'A lead agent assigns tasks to independent coding agents.' },
  { id: 'plan-build-review', name: 'Plan, build, review', evidence: 'Structured handoff', description: 'Assign three roles, with up to two review rounds.' },
  { id: 'build-review', name: 'Build and review', evidence: 'Structured handoff', description: 'One agent builds; another reviews and requests fixes.' },
  { id: 'council', name: 'Ask everyone', evidence: 'Read-only', description: 'Compare independent answers with an agent summary.' },
];
const ICONS = { race: Flag, manager: Workflow, 'plan-build-review': Workflow, 'build-review': GitCompareArrows, council: MessagesSquare };
function StepMark({ state }: { state: string }) {
  return state === 'running' ? <Spinner className="size-3.5" /> : state === 'done' ? <CircleCheck className="size-3.5 text-success" /> : state === 'failed' ? <CircleX className="size-3.5 text-destructive" /> : <Circle className="size-3.5 text-muted-foreground" />;
}

/** Start a coordinated multi-agent run: race in worktrees, or a team recipe. */
export function TeamDialog() {
  const s = useStore();
  const [background, setBackground] = React.useState(true);
  const [error, setError] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const launching = React.useRef(false);
  const [kind, setKind] = React.useState<Kind>('manager');
  const [parallelLimit, setParallelLimit] = React.useState('auto');
  const [task, setTask] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [roles, setRoles] = React.useState<Record<string, string>>({});
  const [checksOpen, setChecksOpen] = React.useState(false);
  const [history, setHistory] = React.useState<{ id: string; recipe: string; task: string; status: string; steps: { role: string; state: string; agentId?: string }[]; error?: string }[]>([]);
  const teamProgress = JSON.stringify(s.thread ? s.st?.teams?.[s.thread.id] ?? null : null);
  React.useEffect(() => {
    if (!s.teamOpen || !s.thread) { setHistory([]); return; }
    let current = true;
    s.hub.call<typeof history>('teamRuns', s.thread.id).then((runs) => { if (current) setHistory(runs); }).catch((e: Error) => { if (current) toast.error(e.message); });
    return () => { current = false; };
  }, [s.teamOpen, s.thread?.id, s.hub, teamProgress]);
  const [testCommand, setTestCommand] = React.useState(() => { try { return localStorage.getItem('tributary.testCommand') || ''; } catch { return ''; } });
  const ready = s.ready;
  React.useEffect(() => {
    if (!s.teamOpen) return;
    setError(''); setTask(s.draft.replace(/^\/team(?:\s+|$)/, '').trim()); setPicked(ready.filter((a) => kind !== 'manager' || !a.connectionId).slice(0, 3).map((a) => a.id)); setChecksOpen(!!testCommand.trim());
    const r = (i: number) => ready[Math.min(i, ready.length - 1)]?.id ?? '';
    setRoles({ planner: r(0), builder: ready.find((a) => a.id === r(1) && !a.connectionId)?.id || ready.find((a) => !a.connectionId)?.id || '', reviewer: r(2), synthesizer: r(0) });
    // Capture defaults when opening; background discovery must not reset an edited team form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.teamOpen]);
  const multi = kind === 'race' || kind === 'council' || kind === 'manager';
  const roleList = kind === 'plan-build-review' ? ['planner', 'builder', 'reviewer'] : kind === 'build-review' ? ['builder', 'reviewer'] : kind === 'council' ? ['synthesizer'] : kind === 'manager' ? ['planner'] : [];
  const LABEL: Record<string, string> = { planner: kind === 'manager' ? 'Lead agent' : 'Planner', builder: 'Builder', reviewer: 'Reviewer', synthesizer: 'Summarizer' };
  const minimum = kind === 'manager' ? 1 : 2;
  const validation = !s.project ? 'Open a project folder first.' : !ready.length ? 'Connect a coding agent to create a team.' : !task.trim() ? 'Describe the task for your team.' : kind === 'manager' && s.mode === 'read' ? 'Enable Edit files to run coding workers.' : multi && picked.length < minimum ? `Choose at least ${minimum} ${minimum === 1 ? 'worker' : 'agents'}.` : multi && picked.some((id) => !ready.some((agent) => agent.id === id && (kind !== 'manager' || !agent.connectionId))) ? 'Choose available agents for every worker.' : roleList.some((role) => !ready.some((agent) => agent.id === roles[role] && (role !== 'builder' || !agent.connectionId))) ? 'Assign an available agent to each role.' : !background && s.running ? 'This chat is busy. Choose a new background chat.' : '';
  const canStart = !validation;


  const start = async () => {
    if (launching.current || !canStart || !s.project || !background && s.running) return;
    launching.current = true; setStarting(true); setError('');
    let run: Promise<{ error?: string }> | null = null;
    try {
      let t = background ? null : s.thread;
      if (!t) {
        t = await s.hub.call<Thread>('createThread', s.project);
        if (background && kind !== 'council') await s.hub.call('createWorktree', t.id);
        if (!background) await s.openThread(t.id);
      }
      try { localStorage.setItem('tributary.testCommand', testCommand); } catch { /* optional preference */ }
      s.setTeamOpen(false);
      if (!background) s.setDraft('');
      run = kind === 'race'
        ? s.hub.call<{ error?: string }>('runRace', t.id, { task, agents: picked, testCommand: testCommand.trim() || undefined, mode: s.mode === 'full' ? 'full' : 'edit' })
        : s.hub.call<{ error?: string }>('runTeam', t.id, { recipe: kind, task, mode: s.mode, roles: kind === 'council' ? { members: picked, synthesizer: roles.synthesizer } : kind === 'manager' ? { planner: roles.planner, workers: picked } : roles, testCommand: kind === 'manager' ? testCommand.trim() || undefined : undefined, ...(kind === 'manager' && parallelLimit !== 'auto' ? { maxParallel: Math.min(Number(parallelLimit), picked.length) } : {}) });
      if (background) { const id = t.id; toast.message('Team started in background', { action: { label: 'View', onClick: () => s.openThread(id) } }); }
    } catch (e) { setError((e as Error).message); toast.error((e as Error).message); }
    finally { launching.current = false; setStarting(false); }
    if (run) {
      try { const result = await run; if (result?.error) toast.error(result.error); }
      catch (e) { toast.error((e as Error).message); }
    }
  };

  return (
    <Dialog open={s.teamOpen} onOpenChange={s.setTeamOpen}>
      <DialogContent className="team-dialog max-h-[90dvh] gap-4 overflow-y-auto sm:max-w-2xl max-sm:[&_input]:min-h-11 max-sm:[&_select]:min-h-11 max-sm:[&_button]:min-h-11">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle className="flex items-center gap-2 leading-6"><Users className="size-4" /> Agent teams</DialogTitle>
          <DialogDescription className="text-xs">Delegate tasks. Keep working while agents run.</DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" variant="outline" spacing={2} value={kind} onValueChange={(v) => { if (!v) return; setKind(v as Kind); setParallelLimit('auto'); if (v === 'manager') setPicked((ids) => ids.filter((id) => ready.some((a) => a.id === id && !a.connectionId))); }} aria-label="How the agents work together" className="grid w-full grid-cols-2 items-stretch gap-1.5 sm:grid-cols-3">
          {KINDS.map((k) => (
            <ToggleGroupItem key={k.id} value={k.id} className="h-10 min-w-0 justify-start rounded-md border-border/70 px-2.5 text-left font-normal whitespace-normal text-foreground data-[state=on]:border-foreground/25 data-[state=on]:bg-muted">
              <span className="flex items-center gap-2 text-[13px] font-medium">{React.createElement(ICONS[k.id], { className: 'size-4 shrink-0 text-muted-foreground' })}<span className="min-w-0 flex-1">{k.name}</span><Check className={cn('size-3.5 shrink-0 max-sm:hidden', kind !== k.id && 'invisible')} /></span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="-mt-2 text-xs leading-5 text-muted-foreground">{KINDS.find((workflow) => workflow.id === kind)?.description}</p>
        <FieldGroup className="gap-4">
          <Field><FieldLabel htmlFor="team-task">Task</FieldLabel>
            <Textarea id="team-task" rows={3} value={task} onChange={(e) => setTask(e.target.value)} placeholder={kind === 'council' ? 'Ask a question for your agents…' : 'Describe what you want the team to deliver…'} /></Field>
          <Field><FieldLabel htmlFor="team-run-target">Run in</FieldLabel><NativeSelect id="team-run-target" value={background ? 'background' : 'current'} onChange={(e) => setBackground(e.target.value === 'background')}><NativeSelectOption value="background">New background chat</NativeSelectOption><NativeSelectOption value="current">Current chat</NativeSelectOption></NativeSelect><FieldDescription>{background ? kind === 'council' ? 'Keep working here. Follow progress in Live activity.' : 'Separate working copy. Review and merge when ready.' : 'Results appear in this chat.'}</FieldDescription></Field>
          {multi && (
            <Field><div className="flex items-center justify-between gap-2"><FieldLabel>{kind === 'race' ? 'Agents racing' : kind === 'manager' ? 'Workers' : 'Agents answering'}</FieldLabel><span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{picked.length} selected</span></div>
              <ToggleGroup type="multiple" variant="outline" spacing={2} value={picked} onValueChange={(ids) => { setPicked(ids); setParallelLimit('auto'); }} aria-label={kind === 'race' ? 'Agents racing' : kind === 'manager' ? 'Workers' : 'Agents answering'} className="w-full flex-wrap justify-start">
                {ready.filter((a) => kind !== 'manager' || !a.connectionId).map((a) => (
                  <ToggleGroupItem key={a.id} value={a.id} className="h-10 max-w-full gap-2 rounded-md px-2 text-[13px] data-[state=on]:bg-muted"><AgentAvatar agent={a} size="sm" muted={!picked.includes(a.id)} /><span className="min-w-0 truncate">{a.name}</span><Check aria-hidden className={cn('size-3.5 shrink-0', !picked.includes(a.id) && 'invisible')} /></ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>{kind === 'manager' && s.mode === 'read' ? 'Enable Edit files in the chat to run coding workers.' : kind === 'manager' ? 'Pick at least one worker.' : 'Pick at least two.'}</FieldDescription></Field>
          )}
          {kind === 'manager' && <Field><FieldLabel htmlFor="team-parallel-limit">Workers at once</FieldLabel><NativeSelect id="team-parallel-limit" value={parallelLimit} onChange={(e) => setParallelLimit(e.target.value)}><NativeSelectOption value="auto">One per selected agent</NativeSelectOption>{Array.from({ length: Math.max(1, picked.length) }, (_, i) => <NativeSelectOption key={i + 1} value={String(i + 1)}>{i + 1}</NativeSelectOption>)}</NativeSelect></Field>}
          {roleList.length > 0 && (
            <div className={cn("grid gap-3", roleList.length > 1 && "sm:grid-cols-3")}>
              {roleList.map((r) => (
                <Field key={r}><FieldLabel htmlFor={`role-${r}`}>{LABEL[r]}</FieldLabel>
                  <NativeSelect id={`role-${r}`} value={roles[r] ?? ''} onChange={(e) => setRoles({ ...roles, [r]: e.target.value })}>
                    {ready.filter((a) => r !== 'builder' || !a.connectionId).map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
                  </NativeSelect></Field>
              ))}
            </div>
          )}
          {(kind === 'race' || kind === 'manager') && (
            <details open={checksOpen} onToggle={(event) => setChecksOpen(event.currentTarget.open)} className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-[13px] font-medium">Checks <span className="ml-1 text-xs font-normal text-muted-foreground">{testCommand.trim() ? 'Configured' : 'Optional'}</span></summary><Field className="mt-3"><FieldLabel htmlFor="team-test">Test command</FieldLabel>
              <Input id="team-test" className="font-mono" value={testCommand} onChange={(e) => setTestCommand(e.target.value)} placeholder="npm test…" spellCheck={false} autoComplete="off" />
              <FieldDescription>Runs in each working copy. Requires Git.</FieldDescription></Field></details>
          )}
        </FieldGroup>
        {history.length > 0 && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer text-[13px] font-medium">Recent team runs <span className="text-xs tabular-nums text-muted-foreground">({history.length})</span></summary><ul className="mt-3 space-y-2">{history.slice(0, 5).map((run) => <li key={run.id} className="space-y-2 rounded-lg border p-3"><div className="flex items-start gap-2"><p className="min-w-0 flex-1 text-[13px] font-medium">{run.task}</p><span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">{run.status}</span></div><ol className="flex flex-wrap gap-2" aria-label="Recorded team steps">{run.steps.map((step, index) => <li key={index} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"><StepMark state={step.state} /><span className="capitalize">{LABEL[step.role] || step.role}</span>{step.agentId && <><AgentAvatar agent={s.agentOf(step.agentId)} size="xs" /><span>{s.agentOf(step.agentId).name}</span></>}<span className="text-muted-foreground">{step.state}</span></li>)}</ol>{run.error && <p className="text-xs text-destructive">{run.error}</p>}</li>)}</ul></details>}
        {!ready.length && <Button size="sm" variant="outline" onClick={() => { s.setTeamOpen(false); s.openSettings('connections'); }}>Connect an agent</Button>}
        {(error || validation) && <p role={error ? 'alert' : 'status'} className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error || validation}</p>}
        <DialogFooter className="grid grid-cols-2 border-t pt-3 sm:flex">
          <span className="col-span-2 mr-auto flex items-center gap-1.5 self-center text-xs text-muted-foreground">{kind === 'council' ? <ShieldCheck className="size-3.5" /> : <Workflow className="size-3.5" />}{KINDS.find((workflow) => workflow.id === kind)?.evidence}</span>
          <Button variant="outline" onClick={() => s.setTeamOpen(false)}>Cancel</Button>
          <Button onClick={start} disabled={!canStart || starting || (!background && s.running)}>{starting ? 'Starting…' : background ? 'Start in background' : kind === 'race' ? 'Start race' : 'Start team'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
