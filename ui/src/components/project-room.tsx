import * as React from 'react';
import { Check, Circle, CircleDot, Copy, LogOut, Plus, RefreshCw, Server, Users, Workflow, Activity, FolderOpen, ArrowRight, ArrowLeft, X, Settings2, ListTodo, Search, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';
import type { RoomState, RoomTask } from '../../../core/collaboration/client.mjs';

export interface RoomBridge {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on(name: 'collaboration', fn: (state: RoomState) => void): void | (() => void);
}
type LanHostState = { running: boolean; addresses: string[]; endpoint: string; fingerprint: string; address: string; port: number };
const initial: RoomState = { status: 'disconnected', endpoint: '', user: null, projects: [], snapshot: null, error: null };
const labels: Record<RoomTask['status'], string> = { ready: 'Ready', claimed: 'Claimed', working: 'In progress', blocked: 'Blocked', review: 'Ready for review', done: 'Reported done' };
export function ProjectRoom({ bridge, endpoint: defaultEndpoint = '', agents = [], canHost = false, localProjects = [], initialProjectPath, folderLinks = {}, onLinkProject, onUseTask, onOpenAgents, onOpenActivity, onClose }: {
  bridge: RoomBridge; onClose?: () => void; canHost?: boolean; endpoint?: string; agents?: { id: string; name: string }[];
  localProjects?: Pick<Project, 'path' | 'name'>[]; initialProjectPath?: string | null; folderLinks?: Record<string, string>;
  onLinkProject?: (endpoint: string, projectId: string, path: string) => Promise<void>;
  onUseTask?: (task: RoomTask, projectPath?: string) => void | Promise<void>;
  onOpenAgents?: (projectPath: string, task?: RoomTask) => void | Promise<void>; onOpenActivity?: () => void;
}) {
  const native = typeof window !== 'undefined' && !!window.hub;
  const [peers, setPeers] = React.useState<{ name: string; endpoint: string; fingerprint: string }[]>([]);
  const [setupMode, setSetupMode] = React.useState(canHost ? 'host' : 'join');
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const cancelStart = React.useRef(false);
  const [notice, setNotice] = React.useState('');
  const [taskFilter, setTaskFilter] = React.useState('all');
  const [searching, setSearching] = React.useState(false);
  const [host, setHost] = React.useState<LanHostState | null>(null);
  const [hostAddress, setHostAddress] = React.useState('');
  const [hostPort, setHostPort] = React.useState('4318');
  const [fingerprint, setFingerprint] = React.useState('');
  const [verified, setVerified] = React.useState(false);
  const [state, setState] = React.useState<RoomState>(initial);
  React.useEffect(() => {
    if (!canHost) return;
    let active = true;
    bridge.call<LanHostState>('lanHostState').then((value) => { if (active) setHost(value); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [bridge, canHost, state.endpoint]);
  const [endpoint, setEndpoint] = React.useState(defaultEndpoint); const [accessKey, setAccessKey] = React.useState('');
  const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [newProject, setNewProject] = React.useState(false); const [projectName, setProjectName] = React.useState(localProjects.find((p) => p.path === initialProjectPath)?.name || '');
  const [createFolder, setCreateFolder] = React.useState(localProjects.find((p) => p.path === initialProjectPath)?.path || '');
  const [adding, setAdding] = React.useState(false); const [title, setTitle] = React.useState(''); const [description, setDescription] = React.useState(''); const [dependency, setDependency] = React.useState('');
  const [inviting, setInviting] = React.useState(false); const [person, setPerson] = React.useState(''); const [invitation, setInvitation] = React.useState('');
  const [agent, setAgent] = React.useState(agents[0]?.name || 'My agent'); const [filter, setFilter] = React.useState('');
  const [selected, setSelected] = React.useState<{ id: string; revision: number; note: string; status: RoomTask['status'] } | null>(null);
  const taskDetails = React.useRef<HTMLElement>(null);
  React.useEffect(() => { if (selected?.id) requestAnimationFrame(() => { taskDetails.current?.focus({ preventScroll: true }); taskDetails.current?.scrollIntoView({ block: 'nearest' }); }); }, [selected?.id]);
  const [roomView, setRoomView] = React.useState('tasks');
  const mobile = useIsMobile();
  React.useEffect(() => {
    let active = true;
    const off = bridge.on('collaboration', (s) => { if (active) setState(s); });
    bridge.call<RoomState>('collaborationState').then((s) => { if (active) setState(s); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; if (typeof off === 'function') off(); };
  }, [bridge]);
  React.useEffect(() => { setSelected(null); setAdding(false); setInviting(false); setInvitation(''); setError(''); }, [state.snapshot?.project.id]);
  const perform = async (work: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const startHosting = () => perform(async () => {
    cancelStart.current = false;
    setStarting(!host?.running);
    try {
      try {
        const value = await bridge.call<LanHostState>('startLanHost', { address: hostAddress || host?.addresses[0], port: Number(hostPort) });
        if (!cancelStart.current) { setHost(value); setEndpoint(value.endpoint); setFingerprint(value.fingerprint); setVerified(true); }
      } catch (e) { if (!cancelStart.current) throw e; }
      // Wait for the whole start-and-connect request before stopping. This also
      // handles a cancel while the certificate or owner connection is pending.
      if (cancelStart.current) { setHost(await bridge.call<LanHostState>('stopLanHost')); setAccessKey(''); setNotice('Room startup cancelled.'); }
    } finally {
      try { setHost(await bridge.call<LanHostState>('lanHostState')); }
      finally { setStarting(false); setCancelling(false); }
    }
  });
  const command = <T,>(action: string, data: Record<string, unknown>) => bridge.call<T>('collaborationCommand', action, data, crypto.randomUUID());
  const snapshot = state.snapshot; const user = state.user;
  const task = snapshot?.tasks.find((t) => t.id === selected?.id);
  const stale = !!(task && selected && task.revision !== selected.revision);
  const folderKey = JSON.stringify([state.endpoint, snapshot?.project.id]);
  const linkedPath = localProjects.find((p) => p.path === folderLinks[folderKey])?.path;
  const filtered = snapshot?.tasks.filter((t) => `${t.title} ${t.description} ${labels[t.status]}`.toLowerCase().includes(filter.trim().toLowerCase()) && (taskFilter === 'all' || taskFilter === 'mine' && t.owner === user?.id || taskFilter === 'available' && t.status === 'ready' || taskFilter === 'working' && ['claimed', 'working'].includes(t.status) || taskFilter === 'blocked' && t.status === 'blocked' || taskFilter === 'review' && t.status === 'review' || taskFilter === 'done' && t.status === 'done')) || [];
  const createRoomProject = () => perform(async () => {
    const created = await command<{ id: string }>('createProject', { name: projectName });
    if (onLinkProject && createFolder) await onLinkProject(state.endpoint, created.id, createFolder);
    setNewProject(false);
  });
  const openProjectForm = () => { setNewProject(true); setRoomView('tasks'); };
  const projectForm = <form className="max-w-lg space-y-4 rounded-xl border bg-card p-4" aria-label="Create shared project" onSubmit={(e) => { e.preventDefault(); createRoomProject(); }}>
    <Field><FieldLabel htmlFor="new-room-project">Project name</FieldLabel><Input id="new-room-project" aria-label="New project name" placeholder="Project name" required maxLength={100} value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus /></Field>
    {onLinkProject && <Field><FieldLabel htmlFor="new-room-folder">Local project</FieldLabel><NativeSelect id="new-room-folder" value={createFolder} onChange={(e) => { setCreateFolder(e.target.value); if (!projectName) setProjectName(localProjects.find((p) => p.path === e.target.value)?.name || ''); }}><NativeSelectOption value="">Choose later</NativeSelectOption>{localProjects.map((p) => <NativeSelectOption key={p.path} value={p.path}>{p.name}</NativeSelectOption>)}</NativeSelect></Field>}
    <div className="flex gap-2"><Button type="submit" disabled={busy}>Create project</Button>{snapshot && <Button type="button" variant="ghost" onClick={() => setNewProject(false)}>Cancel</Button>}</div>
  </form>;
  const connected = !!user && state.status !== 'disconnected';
  const hostingControls = (canHost && host?.running && !starting && <section aria-label="LAN hosting" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3 sm:px-7">
        <div className="flex min-w-0 items-start gap-2"><Server className="mt-0.5 size-4 shrink-0 text-success" /><div className="min-w-0"><p className="text-xs font-medium">Hosting on this network</p><code className="break-all text-xs text-muted-foreground">{host.endpoint}</code><p className="mt-1 text-xs text-muted-foreground">Keeps running when you return to your workspace.</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" aria-label="Copy connection details" disabled={busy} onClick={() => perform(() => navigator.clipboard.writeText(`Address: ${host.endpoint}\nCertificate fingerprint: ${host.fingerprint}`))}><Copy /> Copy details</Button>
          {!connected && <Button size="sm" variant="outline" disabled={busy} onClick={startHosting}>{busy ? 'Opening…' : 'Open hosted room'}</Button>}
          <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={busy}><Square />Stop hosting</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Stop hosting this room?</AlertDialogTitle><AlertDialogDescription>Everyone will disconnect. Projects and tasks stay saved for the next time you host.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep hosting</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => perform(async () => { setHost(await bridge.call<LanHostState>('stopLanHost')); setAccessKey(''); setNotice('Hosting stopped. Projects and tasks are saved.'); })}>Stop hosting</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </div>
      </section>);
  const leaveRoom = connected && !starting && <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={busy}><LogOut />Leave room</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave this room?</AlertDialogTitle><AlertDialogDescription>{host?.running && host.endpoint === state.endpoint ? 'You will leave the room view. Hosting continues for your teammates. Use Stop hosting to disconnect everyone.' : 'Only you will disconnect. Your teammates can keep working, and shared tasks stay saved.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Stay in room</AlertDialogCancel><AlertDialogAction onClick={() => perform(async () => { await bridge.call('collaborationDisconnect'); setAccessKey(''); setNotice('You left the room. Shared tasks are saved.'); })}>Leave room</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
  return (
    <main className="flex h-full min-h-0 flex-col bg-background max-sm:[&_button]:min-h-11 max-sm:[&_input:not([type=checkbox])]:min-h-11">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4 sm:px-7">
        <img src="./logo.svg" alt="" className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold text-balance">Project room</h1><p className="text-xs text-muted-foreground">Team tasks & live progress.</p></div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-between">
          {connected && <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><span className={cn('size-1.5 rounded-full', state.status === 'live' ? 'bg-success' : 'bg-warning')} />{state.status === 'live' ? 'Live' : state.status === 'reconnecting' ? 'Reconnecting' : 'Connected'}</span>}
          {(!host?.running || host.endpoint !== state.endpoint) && leaveRoom}
          {onClose && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft />Back to workspace</Button></TooltipTrigger><TooltipContent>{starting ? 'Room startup continues in the background' : host?.running ? 'Hosting continues. Keep Tributary open.' : connected ? 'Stay connected while you work' : 'Close room setup'}</TooltipContent></Tooltip>}
        </div>
      </header>
      {(error || state.error) && <div role="alert" className="mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error || state.error}</div>}
      {notice && <p role="status" className="shrink-0 border-b px-5 py-3 text-xs text-muted-foreground sm:px-7">{notice}</p>}
      {starting && <section aria-label="Room startup" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3 sm:px-7"><div role="status"><p className="text-sm font-medium">{cancelling ? 'Cancelling room startup…' : 'Starting your room…'}</p><p className="mt-1 text-xs text-muted-foreground">{cancelling ? 'Waiting for startup to finish so the room can shut down safely.' : 'Preparing a secure connection. You can keep working in your workspace.'}</p></div><Button size="sm" variant="outline" disabled={cancelling} onClick={() => { cancelStart.current = true; setCancelling(true); }}>Cancel start</Button></section>}
      {hostingControls}
      {!connected ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-10 sm:px-10">
          <div className="mx-auto max-w-md">
            <h2 className="text-2xl font-semibold text-balance">Work with your team</h2>
            <p className="mt-2 text-xs text-muted-foreground">Shared tasks. Local agents and files.</p>
            <Tabs value={setupMode} onValueChange={setSetupMode} className="mt-6 gap-4">
              <TabsList className="w-full" aria-label="Room setup">{canHost && <TabsTrigger value="host"><Server />Host a room</TabsTrigger>}<TabsTrigger value="join"><Users />Join a room</TabsTrigger></TabsList>
              {canHost && <TabsContent value="host" className="space-y-5">
                <ol aria-label="Host setup steps" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><li><span className="mr-1 font-medium text-foreground">1</span> Host</li><li><span className="mr-1">2</span> Project</li><li><span className="mr-1">3</span> Invite</li></ol>
            {canHost && !host?.running && <section aria-label="Host a room" className="mt-6 space-y-3 border-b pb-5">
              <Button disabled={busy || !host?.addresses.length} onClick={startHosting}><Server />{starting ? 'Starting…' : 'Host on this network'}</Button>
              <p className="text-xs text-muted-foreground text-pretty">Private room. No terminal needed.</p>
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Hosting options</summary><div className="mt-3 flex flex-wrap items-end gap-3">
                <Field className="min-w-0 flex-1"><FieldLabel htmlFor="host-address">Network address</FieldLabel><NativeSelect id="host-address" value={hostAddress || host?.addresses[0] || ''} onChange={(e) => setHostAddress(e.target.value)} disabled={busy}><NativeSelectOption value="" disabled>Choose a network</NativeSelectOption>{host?.addresses.map((address) => <NativeSelectOption key={address} value={address}>{address}</NativeSelectOption>)}</NativeSelect></Field>
                <Field className="w-24"><FieldLabel htmlFor="host-port">Port</FieldLabel><Input id="host-port" type="number" min={1} max={65535} value={hostPort} onChange={(e) => setHostPort(e.target.value)} disabled={busy} /></Field>
                <Button size="icon-sm" variant="outline" aria-label="Refresh network addresses" disabled={busy} onClick={() => perform(async () => { setHost(await bridge.call<LanHostState>('lanHostState')); setHostAddress(''); })}><RefreshCw /></Button>
              </div></details>
              {host && !host.addresses.length && <p role="status" className="text-xs text-muted-foreground">Connect to a network, then refresh.</p>}
            </section>}
                <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Requirements</summary><ul className="mt-2 list-disc space-y-1 pl-4"><li>Same Wi-Fi or Ethernet</li><li>OpenSSL for the first certificate</li><li>Keep this app open while hosting</li></ul></details>
              </TabsContent>}
              <TabsContent value="join" className="space-y-4">
            {native && <div className="mt-5 space-y-2"><Button variant="outline" size="sm" disabled={searching} onClick={async () => { setSearching(true); setError(''); try { const found = await bridge.call<typeof peers>('discoverPeers'); setPeers(found); if (!found.length) setError('No nearby rooms found. Enter the owner’s address below.'); } catch (e) { setError((e as Error).message); } finally { setSearching(false); } }}><Users />{searching ? 'Searching…' : 'Find nearby rooms'}</Button>{peers.map((peer) => <button key={peer.endpoint} className="flex w-full flex-col rounded-lg border px-3 py-2 text-left text-xs hover:bg-muted" onClick={() => { setEndpoint(peer.endpoint); setFingerprint(peer.fingerprint); setVerified(false); }}><span className="font-medium">{peer.name}</span><span className="text-muted-foreground">{peer.endpoint}</span></button>)}</div>}
            <form className="mt-5 space-y-5" onSubmit={(e) => { e.preventDefault(); perform(async () => { await bridge.call('collaborationConnect', { endpoint, accessKey, ...(native && fingerprint ? { fingerprint } : {}) }); setAccessKey(''); }); }}>
              <Field><FieldLabel htmlFor="room-address">Room address</FieldLabel><Input id="room-address" type="url" required value={endpoint} onChange={(e) => { setEndpoint(e.target.value); setFingerprint(''); setVerified(false); }} placeholder="https://team.example.com" /><FieldDescription>{/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(endpoint) ? 'Local only. Teammates need your network address.' : 'From your invitation.'}</FieldDescription></Field>
              {native && <details open={fingerprint ? true : undefined} className="space-y-2 text-xs"><summary className="cursor-pointer text-muted-foreground">Private network certificate</summary><label className="mt-2 flex flex-col gap-2">Certificate fingerprint<Input aria-label="Certificate fingerprint" value={fingerprint} onChange={(e) => { setFingerprint(e.target.value.trim()); setVerified(false); }} placeholder="SHA-256 from the owner" className="font-mono text-xs" /></label>{fingerprint && <label className="flex items-start gap-2 leading-5"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-1" />I verified this fingerprint with the owner.</label>}</details>}
              <Field><FieldLabel htmlFor="room-access-key">Your access key</FieldLabel><Input id="room-access-key" type="password" required autoComplete="off" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} /><FieldDescription>Invitation key. Kept for this session.</FieldDescription></Field>
              <Button type="submit" disabled={busy || (!!fingerprint && !verified)}>{busy ? 'Connecting…' : 'Join project room'}</Button>
            </form>
              </TabsContent>
            </Tabs>

          </div>
        </div>
      ) : (
        <Tabs value={roomView} onValueChange={setRoomView} orientation={mobile ? 'horizontal' : 'vertical'} className="min-h-0 flex-1 flex-col gap-0 md:flex-row">
          <aside className="flex shrink-0 flex-col gap-4 border-b bg-sidebar/40 p-4 md:w-56 md:border-r md:border-b-0">
            <Field><FieldLabel htmlFor="room-project">Shared project</FieldLabel><NativeSelect id="room-project" disabled={busy} value={snapshot?.project.id || ''} onChange={(e) => perform(async () => { await bridge.call('collaborationWatch', e.target.value); })}><NativeSelectOption value="" disabled>Choose a project</NativeSelectOption>{state.projects.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}</NativeSelect></Field>
            {user.admin && <Button size="sm" variant="ghost" className="hidden justify-start text-muted-foreground md:flex" onClick={openProjectForm}><Plus />New project</Button>}
            <TabsList aria-label="Project room sections" className="grid h-auto w-full grid-cols-3 gap-1 bg-transparent p-0 md:flex md:items-stretch">
              <TabsTrigger value="tasks" className="h-9 justify-start gap-2 px-3 text-[13px] after:hidden"><ListTodo />Tasks<span className="ml-auto hidden text-xs tabular-nums text-muted-foreground md:inline">{snapshot?.tasks.filter((t) => t.status !== 'done').length || 0}</span></TabsTrigger>
              <TabsTrigger value="people" disabled={!snapshot} className="h-9 justify-start gap-2 px-3 text-[13px] after:hidden"><Users />People<span className="ml-auto hidden text-xs tabular-nums text-muted-foreground md:inline">{snapshot?.members.length || 0}</span></TabsTrigger>
              <TabsTrigger value="settings" className="h-9 justify-start gap-2 px-3 text-[13px] after:hidden"><Settings2 />Settings</TabsTrigger>
            </TabsList>
            <div className="mt-auto hidden space-y-2 border-t pt-4 md:block">
              {linkedPath && <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-muted-foreground" title={linkedPath}><FolderOpen className="size-3.5 shrink-0" /><span className="truncate">{localProjects.find((p) => p.path === linkedPath)?.name}</span><Check className="ml-auto size-3.5 shrink-0 text-success" /></div>}
              {onOpenAgents && <Button size="sm" variant="ghost" className="w-full justify-start" disabled={!linkedPath || busy} onClick={() => linkedPath && perform(() => Promise.resolve(onOpenAgents(linkedPath)))}><Workflow />Agent teams</Button>}
              {onOpenActivity && <Button size="sm" variant="ghost" className="w-full justify-start" onClick={onOpenActivity}><Activity />Live activity</Button>}
              <div className="flex min-w-0 items-center gap-2 px-2 pt-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{user.name.slice(0, 1)}</span><div className="min-w-0"><p className="truncate text-xs font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{user.admin ? 'Room owner' : 'Member'}</p></div></div>
            </div>
          </aside>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-5 py-5 sm:px-7">
            <TabsContent value="tasks" className="space-y-4">
            {(!snapshot || newProject) ? <div className="space-y-4"><h2 className="text-xl font-semibold text-balance">{user.admin ? 'Create your shared project' : 'Waiting for project access'}</h2>{user.admin ? projectForm : <p className="text-xs text-muted-foreground">Ask the owner for an invitation.</p>}</div> : <>
              <div className="mb-4 flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold">{snapshot.project.name}</h2><p className="mt-1 text-xs text-muted-foreground">{snapshot.tasks.filter((t) => t.status !== 'done').length} open tasks · {snapshot.members.filter((m) => snapshot.online.includes(m.id)).length} online</p></div>
                {user.admin && <Button size="sm" variant="outline" onClick={() => { setRoomView('people'); setInviting(true); }}><Users /> Invite teammate</Button>}
                {snapshot.tasks.length > 0 && <Button size="sm" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus /> Add task</Button>}
              </div>

              {adding && <form className="mb-5 space-y-4 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); perform(async () => { await command('createTask', { title, description, dependencies: dependency ? [dependency] : [] }); setTitle(''); setDescription(''); setDependency(''); setAdding(false); }); }}><Field><FieldLabel htmlFor="shared-task-title">What needs to get done?</FieldLabel><Input id="shared-task-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, agree on the sign-in API" /></Field><Field><FieldLabel htmlFor="shared-task-details">Details and acceptance checks</FieldLabel><Textarea id="shared-task-details" maxLength={12000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the outcome, interface and checks the next person needs." /></Field><Field><FieldLabel htmlFor="shared-task-dependency">Wait for another task (optional)</FieldLabel><NativeSelect id="shared-task-dependency" value={dependency} onChange={(e) => setDependency(e.target.value)}><NativeSelectOption value="">No dependency</NativeSelectOption>{snapshot.tasks.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.title}</NativeSelectOption>)}</NativeSelect></Field><div className="flex gap-2"><Button size="sm" type="submit" disabled={busy}>Create task</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button></div></form>}
              {!!snapshot.tasks.length && <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Task status filters">{[
                { value: 'all', label: 'All', count: snapshot.tasks.length },
                { value: 'working', label: 'In progress', count: snapshot.tasks.filter((t) => ['claimed', 'working'].includes(t.status)).length },
                { value: 'blocked', label: 'Blocked', count: snapshot.tasks.filter((t) => t.status === 'blocked').length },
                { value: 'review', label: 'Review', count: snapshot.tasks.filter((t) => t.status === 'review').length },
                { value: 'done', label: 'Done', count: snapshot.tasks.filter((t) => t.status === 'done').length },
              ].map((item) => <Button key={item.value} size="sm" variant={taskFilter === item.value ? 'secondary' : 'ghost'} aria-pressed={taskFilter === item.value} onClick={() => setTaskFilter(item.value)} className="gap-2 px-2.5 text-xs">{item.label}<span className="tabular-nums text-muted-foreground">{item.count}</span></Button>)}</div>}
              {!!snapshot.tasks.length && <div className="mb-3 flex flex-wrap gap-2"><div className="flex min-w-40 flex-1 items-center gap-1.5 rounded-md border px-2"><Search className="size-3.5 shrink-0 text-muted-foreground" /><Input aria-label="Find a shared task" placeholder="Find a task…" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-0 flex-1 border-0 px-1 shadow-none focus-visible:ring-0" /></div><NativeSelect aria-label="Filter tasks" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}><NativeSelectOption value="all">All tasks</NativeSelectOption><NativeSelectOption value="mine">Assigned to me</NativeSelectOption><NativeSelectOption value="available">Available</NativeSelectOption><NativeSelectOption value="working">In progress</NativeSelectOption><NativeSelectOption value="blocked">Blocked</NativeSelectOption><NativeSelectOption value="review">Ready for review</NativeSelectOption><NativeSelectOption value="done">Done</NativeSelectOption></NativeSelect></div>}
              <div className={cn('grid min-w-0 gap-4', task && selected && 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]')}>
              <div className={cn('divide-y', snapshot.tasks.length > 0 && 'border-y')}>{filtered.map((t) => {
                const owner = snapshot.members.find((m) => m.id === t.owner); const waiting = t.dependencies.some((d) => snapshot.tasks.find((x) => x.id === d)?.status !== 'done');
                return <div key={t.id} className={cn('flex items-center gap-3 py-4', selected?.id === t.id && 'bg-muted/50')}>
                  {t.status === 'done' ? <Check className="size-4 shrink-0 text-success" /> : t.status === 'ready' ? <Circle className="size-4 shrink-0 text-muted-foreground" /> : <CircleDot className="size-4 shrink-0 text-brand" />}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected({ id: t.id, revision: t.revision, note: t.result, status: t.status })}><span className="block truncate text-sm font-medium">{t.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground"><span className="sm:hidden">{labels[t.status]} · </span>{t.owner ? [owner?.name || 'Former teammate', t.agent].filter(Boolean).join(' · ') : waiting ? 'Waiting for a dependency' : 'Available to claim'}</span></button>
                  <span className="hidden shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground sm:block">{labels[t.status]}</span>
                  {!t.owner && <Button variant="outline" size="sm" disabled={busy || waiting} onClick={() => perform(async () => { await command('claim', { id: t.id, revision: t.revision, agent }); })}>Claim task</Button>}
                </div>;
              })}{!filtered.length && !adding && <div className="grid min-h-64 justify-items-center content-center gap-3 py-12 text-center"><span className="grid size-11 place-items-center rounded-xl bg-muted"><ListTodo className="size-5 text-muted-foreground" /></span><p className="text-sm font-medium">{snapshot.tasks.length ? 'No matching tasks' : 'No tasks yet'}</p>{!snapshot.tasks.length && <Button size="sm" onClick={() => setAdding(true)}><Plus />Create first task</Button>}</div>}</div>
              {task && selected && <section ref={taskDetails} tabIndex={-1} className="min-w-0 self-start space-y-4 rounded-xl border bg-card p-4 outline-none xl:sticky xl:top-0" aria-label="Task details"><div className="flex items-center gap-3"><h3 className="min-w-0 flex-1 text-base font-semibold">{task.title}</h3><Button size="icon-xs" variant="ghost" aria-label="Close task details" onClick={() => setSelected(null)}><X /></Button></div><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.description || 'No additional details.'}</p>
                {task.dependencies.length > 0 && <p className="text-xs text-muted-foreground">Depends on: {task.dependencies.map((d) => snapshot.tasks.find((t) => t.id === d)?.title || 'Unavailable task').join(', ')}</p>}
                {stale && <div role="status" className="rounded-lg bg-muted p-3 text-sm">This task changed while you were reading it. Your note is preserved.<Button className="mt-2 block" size="sm" variant="outline" onClick={() => setSelected({ id: task.id, revision: task.revision, note: task.result, status: task.status })}><RefreshCw /> Load latest note</Button></div>}
                {task.owner === user.id ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); perform(async () => { const r = await command<RoomTask>('update', { id: task.id, revision: selected.revision, status: selected.status, result: selected.note }); setSelected({ id: r.id, revision: r.revision, status: r.status, note: r.result }); }); }}><Field><FieldLabel htmlFor="task-progress">Progress</FieldLabel><NativeSelect id="task-progress" value={selected.status} onChange={(e) => setSelected({ ...selected, status: e.target.value as RoomTask['status'] })}>{Object.entries(labels).filter(([v]) => v !== 'ready').map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field><Field><FieldLabel htmlFor="task-progress-note">Result, blocker or evidence link</FieldLabel><Textarea id="task-progress-note" value={selected.note} maxLength={6000} onChange={(e) => setSelected({ ...selected, note: e.target.value })} /></Field><div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || stale}>Save progress</Button>{onUseTask && <Button variant="outline" type="button" size="sm" disabled={!linkedPath || busy} onClick={() => perform(() => Promise.resolve(onUseTask(task, linkedPath)))}><ArrowRight />Work locally</Button>}{onOpenAgents && <Button variant="outline" type="button" size="sm" disabled={!linkedPath || busy} onClick={() => linkedPath && perform(() => Promise.resolve(onOpenAgents(linkedPath, task)))}><Workflow />Run with agents</Button>}{onUseTask && !linkedPath && <span className="text-xs text-muted-foreground">Choose a local folder first.</span>}</div></form> : task.result && <p className="whitespace-pre-wrap text-sm leading-6">{task.result}</p>}
                {task.owner && (task.owner === user.id || user.admin) && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" disabled={busy || stale}>Release task</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Release this task?</AlertDialogTitle><AlertDialogDescription>Another teammate will be able to claim it. This does not stop any agent running on your computer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep task</AlertDialogCancel><AlertDialogAction onClick={() => perform(async () => { await command('release', { id: task.id, revision: task.revision }); setSelected(null); })}>Release task</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
              </section>}
              </div>
            </>}
            </TabsContent>
            <TabsContent value="people" className="space-y-5">
              <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">People</h2><p className="mt-1 text-xs text-muted-foreground">{snapshot?.members.length || 0} {(snapshot?.members.length || 0) === 1 ? 'member' : 'members'}</p></div>{user.admin && <Button size="sm" onClick={() => setInviting(!inviting)}><Plus />Invite teammate</Button>}</div>
              {snapshot && <>
              {inviting && <form className="mb-5 space-y-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); perform(async () => { const r = await command<{ accessKey?: string }>('invite', { name: person }); setInvitation(r.accessKey ? `Tributary project: ${snapshot.project.name}\nAddress: ${state.endpoint}${(host?.endpoint === state.endpoint ? host.fingerprint : fingerprint) ? `\nCertificate fingerprint: ${host?.endpoint === state.endpoint ? host.fingerprint : fingerprint}` : ''}\nAccess key: ${r.accessKey}` : 'This invitation key was already delivered. Create a new invitation if it was lost.'); setPerson(''); }); }}><Field><FieldLabel htmlFor="teammate-name">Teammate name</FieldLabel><Input id="teammate-name" required maxLength={80} value={person} onChange={(e) => setPerson(e.target.value)} /></Field><Button size="sm" type="submit" disabled={busy}>Create invitation</Button>{invitation && <><Textarea aria-label="Private invitation" readOnly value={invitation} className="min-h-24 font-mono text-xs" /><p className="text-xs text-muted-foreground">Share privately. Key shown once.</p><Button size="sm" type="button" variant="outline" onClick={() => perform(async () => { await navigator.clipboard.writeText(invitation); })}><Copy /> Copy invitation</Button></>}</form>}
              <div><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-medium text-muted-foreground">Members</h3></div><ul className="space-y-3">{snapshot.members.map((m) => <li key={m.id} className="flex items-center gap-2 text-sm"><span className={cn('size-1.5 shrink-0 rounded-full', snapshot.online.includes(m.id) ? 'bg-success' : 'bg-muted-foreground/30')} title={snapshot.online.includes(m.id) ? 'Viewing this room' : 'Not connected to this room'} /><span className="min-w-0 flex-1 truncate">{m.name}{m.id === user.id ? ' (you)' : ''}</span>{user.admin && m.id !== user.id && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`Remove ${m.name} from this project`}><X className="size-3" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {m.name} from this project?</AlertDialogTitle><AlertDialogDescription>They will lose access to this room. Their task history will remain.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep access</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => perform(async () => { await command('revoke', { userId: m.id }); })}>Remove access</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</li>)}</ul></div>
              </>}
            </TabsContent>
            <TabsContent value="settings" className="space-y-6">
              <div><h2 className="text-xl font-semibold">Room settings</h2><p className="mt-1 text-xs text-muted-foreground">Connection and local workspace</p></div>
              {snapshot && <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
              {onLinkProject && <Field><FieldLabel htmlFor="local-room-project"><FolderOpen className="size-3.5" />Local folder</FieldLabel><NativeSelect id="local-room-project" disabled={busy} value={linkedPath || ''} onChange={(e) => perform(() => onLinkProject(state.endpoint, snapshot.project.id, e.target.value))}><NativeSelectOption value="" disabled>Choose a local project</NativeSelectOption>{localProjects.map((p) => <NativeSelectOption key={p.path} value={p.path}>{p.name}</NativeSelectOption>)}</NativeSelect><FieldDescription>Files stay on this computer.</FieldDescription></Field>}
              <Field><FieldLabel htmlFor="room-agent">Task agent</FieldLabel>{agents.length ? <NativeSelect id="room-agent" value={agent} onChange={(e) => setAgent(e.target.value)}><NativeSelectOption value="My agent">My agent</NativeSelectOption>{agents.map((a) => <NativeSelectOption key={a.id} value={a.name}>{a.name}</NativeSelectOption>)}</NativeSelect> : <Input id="room-agent" maxLength={100} value={agent} onChange={(e) => setAgent(e.target.value)} />}<FieldDescription>Recorded when you claim a task.</FieldDescription></Field>
              </div>}
              {!host?.running && <div className="min-w-0 rounded-xl border p-4"><p className="mb-2 text-xs font-medium">Room address</p><code className="break-all text-xs text-muted-foreground">{state.endpoint}</code></div>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span className="text-xs text-muted-foreground">Disconnect only this computer</span>{leaveRoom}</div>
              {user.admin && <Button variant="ghost" size="sm" className="md:hidden" onClick={openProjectForm}><Plus />New shared project</Button>}
              <div className="flex flex-wrap gap-2 md:hidden">{onOpenAgents && <Button size="sm" variant="outline" disabled={!linkedPath || busy} onClick={() => linkedPath && perform(() => Promise.resolve(onOpenAgents(linkedPath)))}><Workflow />Agent teams</Button>}{onOpenActivity && <Button size="sm" variant="outline" onClick={onOpenActivity}><Activity />Live activity</Button>}</div>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </main>
  );
}
