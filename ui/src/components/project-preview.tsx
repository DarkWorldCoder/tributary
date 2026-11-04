import * as React from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, ChevronDown, Code2, ExternalLink, Globe, Monitor, MoreHorizontal, Play, Plus, RotateCw, Server, Smartphone, Square, Tablet, Wrench, X } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { projectProfile, localPreviewUrl, type ProjectProfile } from '@/lib/project-profile.mjs';
import { newPreviewTab, navigatePreview, movePreview, previewAddress, previewTitle, type PreviewTab } from '@/lib/preview-tabs.mjs';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { FileContent } from '@/types';

type ServerState = { project: string; status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'; command: string; url: string; output: string; error: string; code: number | null };
type BrowserState = { tabs: PreviewTab[]; active: string };
const sessions = new Map<string, BrowserState>();
function savedAddress(project: string) { try { return localPreviewUrl(JSON.parse(localStorage.getItem('tributary.previewUrls') || '{}')[project] || '') || ''; } catch { return ''; } }
function initialBrowser(project: string): BrowserState { const tab = newPreviewTab(crypto.randomUUID()); return sessions.get(project) || { tabs: [tab], active: tab.id }; }
const sizes = { responsive: { label: 'Responsive', width: '100%', icon: Monitor }, tablet: { label: 'Tablet · 768 px', width: 768, icon: Tablet }, phone: { label: 'Phone · 390 px', width: 390, icon: Smartphone } };

export function ProjectPreview({ visible = true }: { visible?: boolean }) {
  const s = useStore(); const run = useRunInTerminal(); const project = s.workdir || '';
  const [profile, setProfile] = React.useState<ProjectProfile | null>(null);
  const [error, setError] = React.useState(''); const [browser, setBrowser] = React.useState(() => initialBrowser(project));
  const active = browser.tabs.find((tab) => tab.id === browser.active)!; const shown = previewAddress(active);
  const [address, setAddress] = React.useState(shown || savedAddress(project));
  const [revisions, setRevisions] = React.useState<Record<string, number>>({});
  const [size, setSize] = React.useState<keyof typeof sizes>('responsive'); const Device = sizes[size].icon;
  const [server, setServer] = React.useState<ServerState>({ project, status: 'idle', command: '', url: '', output: '', error: '', code: null });
  const [busy, setBusy] = React.useState(false); const [logs, setLogs] = React.useState(false);
  const pendingStart = React.useRef<string | null>(null); const focusTab = React.useRef(false); const addressInput = React.useRef<HTMLInputElement>(null);
  const desktop = s.hub.platform === 'desktop';
  const running = server.status === 'running' || server.status === 'starting';
  const stopped = !!server.command && ['stopped', 'failed'].includes(server.status);
  const start = profile?.commands.find((item) => / run (dev|start)$/.test(item.command));
  React.useEffect(() => { sessions.set(project, browser); }, [project, browser]);
  React.useEffect(() => { setAddress(shown); setError(''); }, [browser.active, shown]);
  React.useEffect(() => {
    let current = true;
    (async () => { const files = await s.hub.call<string[]>('listFiles', project); const pkg = files.includes('package.json') ? await s.hub.call<FileContent>('readFile', project, 'package.json').catch(() => null) : null; if (current) setProfile(projectProfile(files, pkg?.content)); })().catch(() => { if (current) setError('Could not inspect project files.'); });
    return () => { current = false; };
  }, [s.hub, project]);
  React.useEffect(() => {
    if (!desktop || !visible) return;
    let current = true; let received = false;
    const off = s.hub.on('preview-server', (state: ServerState) => { if (state.project === project) { received = true; setServer(state); } });
    s.hub.call<ServerState>('previewServerState', project).then((state) => { if (current && !received) setServer(state); }).catch(() => { if (current) setError('Preview controls are unavailable. Restart Tributary to load the update.'); });
    return () => { current = false; if (typeof off === 'function') off(); };
  }, [s.hub, project, desktop, visible]);
  React.useEffect(() => {
    if (!pendingStart.current || !server.url || !running) return;
    const id = pendingStart.current; pendingStart.current = null;
    setBrowser((state) => ({ ...state, tabs: state.tabs.map((tab) => tab.id === id ? navigatePreview(tab, server.url) || tab : tab) }));
    setRevisions((state) => ({ ...state, [id]: (state[id] || 0) + 1 }));
  }, [server.url, running]);
  React.useEffect(() => {
    if (!visible) return;
    const tab = document.querySelector<HTMLElement>(`[data-preview-tab="${browser.active}"] [role="tab"]`);
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focusTab.current) { focusTab.current = false; tab?.focus(); }
  }, [browser.active, visible]);
  const changeActive = (id: string) => setBrowser((state) => ({ ...state, active: id }));
  const reload = () => setRevisions((state) => ({ ...state, [active.id]: (state[active.id] || 0) + 1 }));
  const go = (value = address) => {
    const tab = navigatePreview(active, value); if (!tab) { setError('Enter a local app address, such as localhost:3000.'); return; }
    setError(''); setAddress(previewAddress(tab)); setBrowser((state) => ({ ...state, tabs: state.tabs.map((item) => item.id === tab.id ? tab : item) })); reload();
    try { const all = JSON.parse(localStorage.getItem('tributary.previewUrls') || '{}'); localStorage.setItem('tributary.previewUrls', JSON.stringify({ ...all, [project]: previewAddress(tab) })); } catch { /* optional preference */ }
  };
  const move = (direction: number) => setBrowser((state) => ({ ...state, tabs: state.tabs.map((tab) => tab.id === active.id ? movePreview(tab, direction) : tab) }));
  const add = () => { const tab = newPreviewTab(crypto.randomUUID()); setBrowser((state) => ({ tabs: [...state.tabs, tab], active: tab.id })); requestAnimationFrame(() => addressInput.current?.focus()); };
  const close = (id: string) => { focusTab.current = id === browser.active; setBrowser((state) => { const index = state.tabs.findIndex((tab) => tab.id === id); const tabs = state.tabs.filter((tab) => tab.id !== id); if (!tabs.length) { const tab = newPreviewTab(crypto.randomUUID()); return { tabs: [tab], active: tab.id }; } return { tabs, active: state.active === id ? tabs[Math.min(index, tabs.length - 1)].id : state.active }; }); };
  const showStart = () => setBrowser((state) => ({ ...state, tabs: state.tabs.map((tab) => tab.id === active.id ? { ...tab, index: -1 } : tab) }));
  const openExternal = (url: string) => void s.hub.call('openExternal', url).catch((e: Error) => toast.error(e.message));
  const control = async (action: 'start' | 'stop' | 'restart') => {
    if (!desktop) { if (start) run(start.command, project); return; }
    setBusy(true); setError(''); pendingStart.current = action === 'stop' ? null : active.id;
    try { setServer(await s.hub.call<ServerState>(`${action}PreviewServer`, project)); } catch (e) { pendingStart.current = null; setError((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); } finally { setBusy(false); }
  };
  return <section aria-label="Project preview" className="flex h-full min-h-0 min-w-0 flex-col bg-background">
    <Tabs.Root value={browser.active} onValueChange={changeActive} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-9 min-w-0 shrink-0 items-center border-b bg-card px-1">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><Tabs.List aria-label="Preview tabs" className="flex w-max items-center">
          {browser.tabs.map((tab) => <div key={tab.id} data-preview-tab={tab.id} className={cn('group flex max-w-52 shrink-0 items-center border-b border-transparent', browser.active === tab.id && 'border-foreground bg-muted/40')}>
            <Tabs.Trigger value={tab.id} title={previewAddress(tab) || 'New tab'} className="flex h-9 min-w-0 items-center gap-2 px-2 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:text-foreground max-sm:h-11"><Globe aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{previewTitle(tab)}</span></Tabs.Trigger>
            <PreviewAction label={`Close preview tab: ${previewTitle(tab)}`} onClick={() => close(tab.id)} className="mr-1 size-6 shrink-0"><X /></PreviewAction>
          </div>)}
        </Tabs.List></div>
        <PreviewAction label="New preview tab" disabled={browser.tabs.length >= 12} onClick={add}><Plus /></PreviewAction>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Preview tabs and tools"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64 max-sm:[&_[role^=menuitem]]:min-h-11">
          <DropdownMenuLabel>Open previews</DropdownMenuLabel>{browser.tabs.map((tab) => <DropdownMenuItem key={tab.id} onSelect={() => changeActive(tab.id)}><Globe /><span className="min-w-0 flex-1 truncate">{previewTitle(tab)}</span>{tab.id === browser.active && <span className="text-xs text-muted-foreground">Active</span>}</DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setBrowser((state) => ({ ...state, tabs: [active] }))} disabled={browser.tabs.length < 2}>Close other tabs</DropdownMenuItem>
          <DropdownMenuSeparator /><DropdownMenuLabel>Project tools</DropdownMenuLabel><DropdownMenuItem onSelect={s.openChecks}><Wrench />Lint, type check & tests</DropdownMenuItem>{profile?.entry && <DropdownMenuItem onSelect={() => s.editFile(profile.entry!)}><Code2 />Open entry file</DropdownMenuItem>}
          {profile?.commands.map((item) => <DropdownMenuItem key={item.command} disabled={s.hub.platform === 'mock'} onSelect={() => run(item.command, project)}><Play /><span className="truncate font-mono text-xs" title={item.command}>{item.command}</span></DropdownMenuItem>)}
          {desktop && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setLogs((value) => !value)}><Server />{logs ? 'Hide server output' : 'Show server output'}</DropdownMenuItem>{running && <DropdownMenuItem disabled={busy} onSelect={() => void control('stop')}><Square />Stop app</DropdownMenuItem>}</>}
        </DropdownMenuContent></DropdownMenu>
      </div>
      <div className="preview-toolbar flex min-w-0 shrink-0 items-center gap-0.5 border-b bg-card px-1 py-1">
        <PreviewAction label="Previous preview address" disabled={active.index < 0} onClick={() => move(-1)}><ArrowLeft /></PreviewAction>
        <PreviewAction label="Next preview address" disabled={active.index >= active.history.length - 1} onClick={() => move(1)}><ArrowRight /></PreviewAction>
        <PreviewAction label="Reload preview" disabled={!shown} onClick={reload}><RotateCw /></PreviewAction>
        <form className="min-w-0 flex-1 px-1" onSubmit={(e) => { e.preventDefault(); go(); }}><Input ref={addressInput} value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Preview address" aria-invalid={!!error || undefined} placeholder="Type a local URL" inputMode="url" enterKeyHint="go" spellCheck={false} autoCapitalize="none" autoCorrect="off" className="h-7 min-w-0 rounded-md border-transparent bg-muted/50 px-2 text-[13px] shadow-none max-sm:h-11" /></form>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label={`Preview size: ${sizes[size].label}`}><Device /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Preview size</DropdownMenuLabel><DropdownMenuRadioGroup value={size} onValueChange={(value) => setSize(value as keyof typeof sizes)}>{(Object.keys(sizes) as (keyof typeof sizes)[]).map((key) => { const Icon = sizes[key].icon; return <DropdownMenuRadioItem key={key} value={key}><Icon />{sizes[key].label}</DropdownMenuRadioItem>; })}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <PreviewAction label="Open preview in browser" disabled={!shown} onClick={() => shown && openExternal(shown)}><ExternalLink /></PreviewAction>
      </div>
      {error && <div role="alert" className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span><button aria-label="Dismiss preview error" className="shrink-0 rounded p-1 hover:bg-muted" onClick={() => setError('')}><X className="size-3.5" /></button></div>}
      <div className="relative min-h-0 min-w-0 flex-1">
        {browser.tabs.map((tab) => <Tabs.Content key={tab.id} value={tab.id} forceMount className={cn('h-full min-h-0 min-w-0 outline-none', browser.active !== tab.id && 'hidden')}>
          {previewAddress(tab) && s.hub.platform !== 'vscode' ? <div aria-label="Preview canvas" className="flex h-full min-w-0 justify-center overflow-auto bg-muted/25"><iframe key={`${project}:${tab.id}:${revisions[tab.id] || 0}`} title={`App preview: ${previewTitle(tab)}`} src={previewAddress(tab)} sandbox="allow-scripts allow-forms allow-same-origin allow-downloads" style={{ width: sizes[size].width }} className="h-full min-h-0 max-w-full shrink-0 border-0 bg-white" /></div> : <div className="grid h-full min-h-0 content-center justify-items-center gap-3 overflow-auto px-6 py-10 text-center"><Globe aria-hidden className="size-8 text-muted-foreground/60" /><h3 className="text-balance text-sm font-medium">{s.hub.platform === 'vscode' && previewAddress(tab) ? 'Open preview in your browser' : 'Preview your app'}</h3><p className="max-w-xs text-pretty text-xs leading-5 text-muted-foreground">{previewAddress(tab) ? 'Use the browser button above.' : 'Enter a local address or start this project.'}</p>{start && !running && !previewAddress(tab) && <Button size="sm" disabled={busy || s.hub.platform === 'mock'} onClick={() => void control('start')} title={start.command}><Play />{busy ? 'Starting…' : 'Start app'}</Button>}{running && !previewAddress(tab) && <Button variant="outline" size="sm" disabled={!server.url} onClick={() => go(server.url)}><Globe />{server.url ? 'Open running app' : 'Waiting for app address…'}</Button>}{!previewAddress(tab) && savedAddress(project) && <Button variant="ghost" size="sm" onClick={() => go(savedAddress(project))}>Open last address</Button>}</div>}
        </Tabs.Content>)}
        {stopped && shown && <div className="absolute inset-0 grid place-items-center bg-background/80 p-5"><div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-lg"><div className="flex min-w-0 items-center gap-2 text-xs"><Server className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono" title={server.command}>{server.command}</span><span className={server.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{server.status === 'failed' ? 'Failed' : 'Stopped'}</span><Button variant="secondary" size="xs" disabled={busy} onClick={() => void control('restart')}>Restart</Button></div><p className="mt-3 text-center text-pretty text-xs leading-5 text-muted-foreground">{server.error || 'Restart the app to reconnect this preview.'}</p><Button variant="ghost" size="sm" className="mt-2 w-full" onClick={showStart}>Show start page</Button></div></div>}
      </div>
    </Tabs.Root>
    {logs && <div className="max-h-44 shrink-0 overflow-auto border-t bg-card"><div className="flex items-center gap-2 px-3 py-1 text-xs"><span className="flex-1">Server output</span><PreviewAction label="Hide server output" onClick={() => setLogs(false)}><X /></PreviewAction></div><pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-xs leading-5 text-muted-foreground">{server.output || 'No server output yet.'}</pre></div>}
    {(server.command || start) && <footer className="flex min-h-8 shrink-0 items-center gap-2 border-t bg-card px-2 text-[11px]"><Server aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-muted-foreground" title={server.command || start?.command}>{server.command || start?.command}</span><span role="status" className={cn('shrink-0', server.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{({ idle: 'Not started', starting: 'Starting', running: 'Process running', stopping: 'Stopping', stopped: 'Stopped', failed: 'Failed' })[server.status]}</span><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" className="max-sm:min-w-11" disabled={busy || s.hub.platform === 'mock'} aria-label={running ? 'Stop app' : 'Start app'} onClick={() => void control(running ? 'stop' : 'start')}>{running ? <Square /> : <Play />}</Button></TooltipTrigger><TooltipContent>{running ? 'Stop app' : 'Start app'}</TooltipContent></Tooltip></footer>}
  </section>;
}
function PreviewAction({ label, className, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) { return <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className={cn('workbench-action shrink-0 [&_svg]:size-4', className)} aria-label={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>; }
