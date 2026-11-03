import * as React from 'react';
import { toast } from 'sonner';
import { Flag, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AgentAvatar } from '@/components/agent-avatar';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Thread } from '@/types';

type Kind = 'race' | 'plan-build-review' | 'build-review' | 'council';
const KINDS: { id: Kind; name: string; evidence: string; description: string }[] = [
  { id: 'race', name: 'Race', evidence: 'Best supported by research', description: 'Every chosen agent tries the same task in its own copy of the project. Your tests decide, you compare the diffs and apply one. Your files stay untouched until then.' },
  { id: 'plan-build-review', name: 'Plan, build, review', evidence: 'Structured handoff', description: 'One agent plans, another builds it, a third reviews. The builder fixes problems until the reviewer approves (two rounds at most).' },
  { id: 'build-review', name: 'Build and review', evidence: 'Structured handoff', description: 'One agent builds, another reviews and asks for fixes until it approves.' },
  { id: 'council', name: 'Ask everyone', evidence: 'Read-only', description: 'Each agent answers the same question without changing files, then one agent compares the answers and recommends.' },
];

/** Start a coordinated multi-agent run: race in worktrees, or a team recipe. */
export function TeamDialog() {
  const s = useStore();
  const [kind, setKind] = React.useState<Kind>('race');
  const [task, setTask] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [roles, setRoles] = React.useState<Record<string, string>>({});
  const [testCommand, setTestCommand] = React.useState(() => { try { return localStorage.getItem('tributary.testCommand') || ''; } catch { return ''; } });
  const ready = s.ready;
  React.useEffect(() => {
    if (!s.teamOpen) return;
    setTask(s.draft); setPicked(ready.slice(0, 3).map((a) => a.id));
    const r = (i: number) => ready[Math.min(i, ready.length - 1)]?.id ?? '';
    setRoles({ planner: r(0), builder: r(1), reviewer: r(2), synthesizer: r(0) });
  }, [s.teamOpen, ready, s.draft]);
  const multi = kind === 'race' || kind === 'council';
  const roleList = kind === 'plan-build-review' ? ['planner', 'builder', 'reviewer'] : kind === 'build-review' ? ['builder', 'reviewer'] : kind === 'council' ? ['synthesizer'] : [];
  const LABEL: Record<string, string> = { planner: 'Planner', builder: 'Builder', reviewer: 'Reviewer', synthesizer: 'Summarizer' };
  const canStart = task.trim() && (multi ? picked.length >= 2 : roleList.every((r) => roles[r])) && (kind !== 'council' || roles.synthesizer);

  const start = async () => {
    let t = s.thread;
    if (!t) { t = await s.hub.call<Thread>('createThread', s.project); s.setThread(t); await s.openThread(t.id); }
    try { localStorage.setItem('tributary.testCommand', testCommand); } catch { /* ignore */ }
    s.setTeamOpen(false); s.setDraft('');
    const r = kind === 'race'
      ? await s.hub.call<{ error?: string }>('runRace', t.id, { task, agents: picked, testCommand: testCommand.trim() || undefined, mode: s.mode === 'full' ? 'full' : 'edit' })
      : await s.hub.call<{ error?: string }>('runTeam', t.id, { recipe: kind, task, mode: s.mode, roles: kind === 'council' ? { members: picked, synthesizer: roles.synthesizer } : roles });
    if (r && r.error) toast.error(r.error);
  };

  return (
    <Dialog open={s.teamOpen} onOpenChange={s.setTeamOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-5" /> Work as a team</DialogTitle>
          <DialogDescription>Several agents take on one task together. Each step shows up in this thread.</DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" variant="outline" spacing={2} value={kind} onValueChange={(v) => { if (v) setKind(v as Kind); }} aria-label="How the agents work together" className="grid w-full gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <ToggleGroupItem key={k.id} value={k.id} className="h-auto flex-col items-start gap-0 rounded-xl p-3 text-left font-normal whitespace-normal text-foreground data-[state=on]:border-brand data-[state=on]:bg-transparent data-[state=on]:ring-1 data-[state=on]:ring-brand">
              <div className="flex items-center gap-2 font-medium">{k.id === 'race' && <Flag className="size-4 text-brand" />}{k.name}</div>
              <div className="mt-0.5 text-xs text-brand">{k.evidence}</div>
              <p className="mt-1 text-xs text-muted-foreground">{k.description}</p>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldGroup>
          <Field><FieldLabel htmlFor="team-task">Task</FieldLabel>
            <Textarea id="team-task" rows={3} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add pagination to the orders API, with tests…" /></Field>
          {multi && (
            <Field><FieldLabel>{kind === 'race' ? 'Agents racing' : 'Agents answering'}</FieldLabel>
              <ToggleGroup type="multiple" variant="outline" spacing={2} value={picked} onValueChange={setPicked} aria-label={kind === 'race' ? 'Agents racing' : 'Agents answering'} className="flex-wrap">
                {ready.map((a) => (
                  <ToggleGroupItem key={a.id} value={a.id} className="h-auto rounded-full py-1 pr-3 pl-1"><AgentAvatar agent={a} size="sm" muted={!picked.includes(a.id)} />{a.name}</ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>Pick at least two.</FieldDescription></Field>
          )}
          {roleList.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {roleList.map((r) => (
                <Field key={r}><FieldLabel htmlFor={`role-${r}`}>{LABEL[r]}</FieldLabel>
                  <NativeSelect id={`role-${r}`} value={roles[r] ?? ''} onChange={(e) => setRoles({ ...roles, [r]: e.target.value })}>
                    {ready.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
                  </NativeSelect></Field>
              ))}
            </div>
          )}
          {kind === 'race' && (
            <Field><FieldLabel htmlFor="team-test">Test command (optional)</FieldLabel>
              <Input id="team-test" className="font-mono" value={testCommand} onChange={(e) => setTestCommand(e.target.value)} placeholder="npm test…" spellCheck={false} autoComplete="off" />
              <FieldDescription>Runs in each agent’s copy when it finishes. Results that pass are marked so you can pick with confidence. Needs a git repository.</FieldDescription></Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => s.setTeamOpen(false)}>Cancel</Button>
          <Button onClick={start} disabled={!canStart || s.running}>{kind === 'race' ? 'Start race' : 'Start team'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
