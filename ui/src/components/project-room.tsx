import * as React from 'react';
import { Check, Circle, CircleDot, Copy, LogOut, Plus, RefreshCw, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import type { RoomState, RoomTask } from '../../../core/collaboration/client.mjs';

export interface RoomBridge {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on(name: 'collaboration', fn: (state: RoomState) => void): void | (() => void);
}
const initial: RoomState = { status: 'disconnected', endpoint: '', user: null, projects: [], snapshot: null, error: null };
const labels: Record<RoomTask['status'], string> = { ready: 'Ready', claimed: 'Claimed', working: 'In progress', blocked: 'Blocked', review: 'Ready for review', done: 'Reported done' };
export function ProjectRoom({ bridge, endpoint: defaultEndpoint = 'http://127.0.0.1:4318', agents = [], onUseTask }: { bridge: RoomBridge; endpoint?: string; agents?: { id: string; name: string }[]; onUseTask?: (task: RoomTask) => void }) {
  const [state, setState] = React.useState<RoomState>(initial);
  const [endpoint, setEndpoint] = React.useState(defaultEndpoint); const [accessKey, setAccessKey] = React.useState('');
  const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [newProject, setNewProject] = React.useState(false); const [projectName, setProjectName] = React.useState('');
  const [adding, setAdding] = React.useState(false); const [title, setTitle] = React.useState(''); const [description, setDescription] = React.useState(''); const [dependency, setDependency] = React.useState('');
  const [inviting, setInviting] = React.useState(false); const [person, setPerson] = React.useState(''); const [invitation, setInvitation] = React.useState('');
  const [agent, setAgent] = React.useState(agents[0]?.name || 'My agent'); const [filter, setFilter] = React.useState('');
  const [selected, setSelected] = React.useState<{ id: string; revision: number; note: string; status: RoomTask['status'] } | null>(null);
  const [showPeople, setShowPeople] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    const off = bridge.on('collaboration', (s) => { if (active) setState(s); });
    bridge.call<RoomState>('collaborationState').then((s) => { if (active) setState(s); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; if (typeof off === 'function') off(); };
  }, [bridge]);
  React.useEffect(() => { setSelected(null); setAdding(false); setInviting(false); setInvitation(''); setError(''); }, [state.snapshot?.project.id]);
  const perform = async (work: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const command = <T,>(action: string, data: Record<string, unknown>) => bridge.call<T>('collaborationCommand', action, data, crypto.randomUUID());
  const snapshot = state.snapshot; const user = state.user;
  const task = snapshot?.tasks.find((t) => t.id === selected?.id);
  const stale = !!(task && selected && task.revision !== selected.revision);
  const filtered = snapshot?.tasks.filter((t) => `${t.title} ${t.description} ${labels[t.status]}`.toLowerCase().includes(filter.trim().toLowerCase())) || [];
  const connected = !!user && state.status !== 'disconnected';
  return (
    <div role="main" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4 sm:px-7">
        <div className="grid size-9 place-items-center rounded-xl border bg-card"><Users className="size-4 text-brand" /></div>
        <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold text-balance">Project room</h1><p className="text-xs text-muted-foreground">Your team, their agents, one shared plan.</p></div>
        {connected && <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end"><Button variant="outline" size="sm" className="md:hidden" aria-expanded={showPeople} onClick={() => setShowPeople(!showPeople)}>People & projects</Button><span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn('size-1.5 rounded-full', state.status === 'live' ? 'bg-success' : 'bg-warning')} />{state.status === 'live' ? 'Live updates' : state.status === 'connected' ? 'Connected' : state.status === 'reconnecting' ? 'Reconnecting' : 'Connecting'}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => perform(async () => { await bridge.call('collaborationDisconnect'); setAccessKey(''); })}><LogOut /> Disconnect</Button></div>}
      </header>
      {(error || state.error) && <div role="alert" className="mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error || state.error}</div>}
      {!connected ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-10 sm:px-10">
          <div className="mx-auto max-w-md">
            <h2 className="text-2xl font-semibold text-balance">Make room for your team.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Share tasks and progress with teammates. Each person keeps their own agents and local files.</p>
            <form className="mt-7 space-y-5" onSubmit={(e) => { e.preventDefault(); perform(async () => { await bridge.call('collaborationConnect', { endpoint, accessKey }); setAccessKey(''); }); }}>
              <Field><FieldLabel htmlFor="room-address">Project service address</FieldLabel><Input id="room-address" type="url" required value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://team.example.com" /></Field>
              <Field><FieldLabel htmlFor="room-access-key">Your access key</FieldLabel><Input id="room-access-key" type="password" required autoComplete="off" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} /><FieldDescription>Ask the owner for an invitation. The key stays in this session and is cleared when you disconnect.</FieldDescription></Field>
              <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Join project room'}</Button>
            </form>
            <details className="mt-8 border-t pt-4 text-sm"><summary className="cursor-pointer font-medium">Set up your own project service</summary><p className="mt-3 leading-6 text-muted-foreground">In the Tributary folder, run <code className="font-mono text-xs">npm run server</code> with Node.js 24. The service prints the private file location of your owner key. It starts on this computer; sharing it with other computers requires an HTTPS address.</p></details>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className={cn('max-h-[45vh] shrink-0 flex-col gap-5 overflow-auto border-b bg-sidebar/50 px-5 py-5 md:flex md:max-h-none md:w-56 md:border-r md:border-b-0', showPeople ? 'flex' : 'hidden')}>
            <div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{user.name.slice(0, 1)}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{user.admin ? 'Server owner' : 'Teammate'}</p></div></div>
            <Field><FieldLabel htmlFor="room-project">Shared project</FieldLabel><NativeSelect id="room-project" disabled={busy} value={snapshot?.project.id || ''} onChange={(e) => perform(async () => { await bridge.call('collaborationWatch', e.target.value); })}><NativeSelectOption value="" disabled>Choose a project</NativeSelectOption>{state.projects.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}</NativeSelect></Field>
            {user.admin && <Button size="sm" variant="outline" onClick={() => setNewProject(!newProject)}><Plus /> New shared project</Button>}
            {newProject && <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); perform(async () => { await command('createProject', { name: projectName }); setProjectName(''); setNewProject(false); }); }}><Input aria-label="New project name" placeholder="Project name" required maxLength={100} value={projectName} onChange={(e) => setProjectName(e.target.value)} /><Button type="submit" size="sm" disabled={busy}>Create project</Button></form>}
            {snapshot && <><div><div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-semibold">People</h2>{user.admin && <Button variant="ghost" size="icon-xs" aria-label="Invite a teammate" onClick={() => setInviting(!inviting)}><Plus /></Button>}</div><ul className="space-y-3">{snapshot.members.map((m) => <li key={m.id} className="flex items-center gap-2 text-sm"><span className={cn('size-1.5 shrink-0 rounded-full', snapshot.online.includes(m.id) ? 'bg-success' : 'bg-muted-foreground/30')} title={snapshot.online.includes(m.id) ? 'Viewing this room' : 'Not connected to this room'} /><span className="min-w-0 flex-1 truncate">{m.name}{m.id === user.id ? ' (you)' : ''}</span>{user.admin && m.id !== user.id && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`Remove ${m.name} from this project`}><X className="size-3" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {m.name} from this project?</AlertDialogTitle><AlertDialogDescription>They will lose access to this room. Their task history will remain.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep access</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => perform(async () => { await command('revoke', { userId: m.id }); })}>Remove access</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</li>)}</ul></div>
              <Field><FieldLabel htmlFor="room-agent">Agent you plan to use</FieldLabel>{agents.length ? <NativeSelect id="room-agent" value={agent} onChange={(e) => setAgent(e.target.value)}><NativeSelectOption value="My agent">My agent</NativeSelectOption>{agents.map((a) => <NativeSelectOption key={a.id} value={a.name}>{a.name}</NativeSelectOption>)}</NativeSelect> : <Input id="room-agent" maxLength={100} value={agent} onChange={(e) => setAgent(e.target.value)} />}<FieldDescription>Recorded when you claim a task. Runs stay on your computer.</FieldDescription></Field>
            </>}
          </aside>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-5 py-5 sm:px-7">
            {!snapshot ? <div className="max-w-lg py-10"><h2 className="text-xl font-semibold">{state.projects.length ? 'Opening your project…' : 'A shared place to begin'}</h2><p className="mt-2 text-sm text-muted-foreground">{user.admin ? 'Create your first shared project, then invite teammates and add tasks.' : 'Your invitation has no active project access. Ask the owner for a new invitation.'}</p></div> : <>
              <div className="mb-5 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="break-words text-xl font-semibold text-balance">{snapshot.project.name}</h2><p className="mt-1 text-sm text-pretty text-muted-foreground">{snapshot.tasks.filter((t) => t.status !== 'done').length} open {snapshot.tasks.filter((t) => t.status !== 'done').length === 1 ? 'task' : 'tasks'}. Progress is reported by the task owner.</p></div><Button size="sm" onClick={() => setAdding(!adding)}><Plus /> Add task</Button></div>
              <p className="mb-5 max-w-prose text-xs leading-5 text-muted-foreground">Task claims and notes are shared live. This board does not run agents, sync files or verify builds. Use separate working copies for parallel code changes.</p>
              {inviting && <form className="mb-5 space-y-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); perform(async () => { const r = await command<{ accessKey?: string }>('invite', { name: person }); setInvitation(r.accessKey ? `Tributary project: ${snapshot.project.name}\nAddress: ${state.endpoint}\nAccess key: ${r.accessKey}` : 'This invitation key was already delivered. Create a new invitation if it was lost.'); setPerson(''); }); }}><Field><FieldLabel htmlFor="teammate-name">Teammate name</FieldLabel><Input id="teammate-name" required maxLength={80} value={person} onChange={(e) => setPerson(e.target.value)} /></Field><Button size="sm" type="submit" disabled={busy}>Create invitation</Button>{invitation && <><Textarea aria-label="Private invitation" readOnly value={invitation} className="min-h-24 font-mono text-xs" /><p className="text-xs text-muted-foreground">Share this privately with the named teammate. The access key is shown once.</p><Button size="sm" type="button" variant="outline" onClick={() => perform(async () => { await navigator.clipboard.writeText(invitation); })}><Copy /> Copy invitation</Button></>}</form>}
              {adding && <form className="mb-5 space-y-4 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); perform(async () => { await command('createTask', { title, description, dependencies: dependency ? [dependency] : [] }); setTitle(''); setDescription(''); setDependency(''); setAdding(false); }); }}><Field><FieldLabel htmlFor="shared-task-title">What needs to get done?</FieldLabel><Input id="shared-task-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, agree on the sign-in API" /></Field><Field><FieldLabel htmlFor="shared-task-details">Details and acceptance checks</FieldLabel><Textarea id="shared-task-details" maxLength={12000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the outcome, interface and checks the next person needs." /></Field><Field><FieldLabel htmlFor="shared-task-dependency">Wait for another task (optional)</FieldLabel><NativeSelect id="shared-task-dependency" value={dependency} onChange={(e) => setDependency(e.target.value)}><NativeSelectOption value="">No dependency</NativeSelectOption>{snapshot.tasks.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.title}</NativeSelectOption>)}</NativeSelect></Field><div className="flex gap-2"><Button size="sm" type="submit" disabled={busy}>Create task</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button></div></form>}
              <Input aria-label="Find a shared task" placeholder="Find a task…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3" />
              <div className="divide-y border-y">{filtered.map((t) => {
                const owner = snapshot.members.find((m) => m.id === t.owner); const waiting = t.dependencies.some((d) => snapshot.tasks.find((x) => x.id === d)?.status !== 'done');
                return <div key={t.id} className={cn('flex items-center gap-3 py-4', selected?.id === t.id && 'bg-muted/50')}>
                  {t.status === 'done' ? <Check className="size-4 shrink-0 text-success" /> : t.status === 'ready' ? <Circle className="size-4 shrink-0 text-muted-foreground" /> : <CircleDot className="size-4 shrink-0 text-brand" />}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected({ id: t.id, revision: t.revision, note: t.result, status: t.status })}><span className="block truncate text-sm font-medium">{t.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{t.owner ? `${owner?.name || 'Former teammate'} · ${t.agent}` : waiting ? 'Waiting for a dependency' : 'Available to claim'}</span></button>
                  <span className="hidden text-xs text-muted-foreground sm:block">{labels[t.status]}</span>
                  {!t.owner && <Button variant="outline" size="sm" disabled={busy || waiting} onClick={() => perform(async () => { await command('claim', { id: t.id, revision: t.revision, agent }); })}>Claim task</Button>}
                </div>;
              })}{!filtered.length && <p className="py-10 text-center text-sm text-muted-foreground">{filter ? 'No tasks match your search.' : 'Add a task so everyone knows where to start.'}</p>}</div>
              {task && selected && <section className="mt-5 space-y-4 rounded-xl border bg-card p-4" aria-label="Task details"><div className="flex items-center gap-3"><h3 className="min-w-0 flex-1 text-base font-semibold">{task.title}</h3><Button size="icon-xs" variant="ghost" aria-label="Close task details" onClick={() => setSelected(null)}><X /></Button></div><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.description || 'No additional details.'}</p>
                {task.dependencies.length > 0 && <p className="text-xs text-muted-foreground">Depends on: {task.dependencies.map((d) => snapshot.tasks.find((t) => t.id === d)?.title || 'Unavailable task').join(', ')}</p>}
                {stale && <div role="status" className="rounded-lg bg-muted p-3 text-sm">This task changed while you were reading it. Your note is preserved.<Button className="mt-2 block" size="sm" variant="outline" onClick={() => setSelected({ id: task.id, revision: task.revision, note: task.result, status: task.status })}><RefreshCw /> Load latest note</Button></div>}
                {task.owner === user.id ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); perform(async () => { const r = await command<RoomTask>('update', { id: task.id, revision: selected.revision, status: selected.status, result: selected.note }); setSelected({ id: r.id, revision: r.revision, status: r.status, note: r.result }); }); }}><Field><FieldLabel htmlFor="task-progress">Progress</FieldLabel><NativeSelect id="task-progress" value={selected.status} onChange={(e) => setSelected({ ...selected, status: e.target.value as RoomTask['status'] })}>{Object.entries(labels).filter(([v]) => v !== 'ready').map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field><Field><FieldLabel htmlFor="task-progress-note">Result, blocker or evidence link</FieldLabel><Textarea id="task-progress-note" value={selected.note} maxLength={6000} onChange={(e) => setSelected({ ...selected, note: e.target.value })} /></Field><div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || stale}>Save progress</Button>{onUseTask && <Button variant="outline" type="button" size="sm" onClick={() => onUseTask(task)}>Prepare in local conversation</Button>}</div></form> : task.result && <p className="whitespace-pre-wrap text-sm leading-6">{task.result}</p>}
                {task.owner && (task.owner === user.id || user.admin) && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" disabled={busy || stale}>Release task</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Release this task?</AlertDialogTitle><AlertDialogDescription>Another teammate will be able to claim it. This does not stop any agent running on your computer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep task</AlertDialogCancel><AlertDialogAction onClick={() => perform(async () => { await command('release', { id: task.id, revision: task.revision }); setSelected(null); })}>Release task</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
              </section>}
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
