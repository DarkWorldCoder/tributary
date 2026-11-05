import type { ShortcutAction } from '../../../core/shortcuts.mjs';
import { ShortcutLabel, ShortcutKeys } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import * as React from 'react';
import { ArrowLeft, ArrowRight, Maximize, Minimize, Minus, PanelLeft, Search, Square, Copy, X } from 'lucide-react';
import { Menubar } from 'radix-ui';
import { useStore } from '@/store';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebar } from '@/components/ui/sidebar';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Desktop-only window chrome; native Mac menus and the VS Code host remain in control there. */
export function DesktopTitlebar() {
  const { platform } = useShortcutPreferences();
  const s = useStore(); const { toggleSidebar } = useSidebar();
  const fullscreen = useFullscreen();
  const [maximized, setMaximized] = React.useState(false);
  // This is a focus hint, not an owner. A removed Find input can otherwise
  // retain its listeners, destroyed editor and complete document through here.
  const editTarget = React.useRef<WeakRef<HTMLElement> | null>(null);
  const history = React.useRef<string[]>([]); const position = React.useRef(-1); const navigating = React.useRef(false);
  const [, refresh] = React.useReducer((n) => n + 1, 0);
  const desktop = s.hub.platform === 'desktop' && !/Mac/.test(navigator.platform);
  React.useEffect(() => {
    const remember = (event: FocusEvent) => { if (event.target instanceof HTMLElement && event.target.matches('input,textarea,[contenteditable=true]')) editTarget.current = new WeakRef(event.target); };
    document.addEventListener('focusin', remember); return () => document.removeEventListener('focusin', remember);
  }, []);
  React.useEffect(() => {
    if (!desktop) return;
    s.hub.call<{ maximized: boolean }>('windowState').then((value) => setMaximized(value.maximized)).catch(() => {});
    const off = s.hub.on('window-state', (value: { maximized: boolean }) => setMaximized(value.maximized));
    return () => { if (typeof off === 'function') off(); };
  }, [desktop, s.hub]);
  React.useEffect(() => {
    if (!s.thread?.id) return;
    if (navigating.current) { navigating.current = false; return; }
    if (history.current[position.current] === s.thread.id) return;
    history.current = [...history.current.slice(0, position.current + 1), s.thread.id].slice(-50); position.current = history.current.length - 1; refresh();
  }, [s.thread?.id]);
  if (!desktop) return null;
  const navigate = async (delta: number) => {
    const next = position.current + delta; const id = history.current[next]; if (!id) return;
    navigating.current = true;
    try { await s.openThread(id); position.current = next; refresh(); } catch { navigating.current = false; toast.error('Could not open chat'); }
  };
  const windowAction = (action: string) => void s.hub.call('windowAction', action).catch(() => toast.error('Window action unavailable'));
  const openWorkspace = () => { void s.hub.call<string | null>('openWorkspace').then(async (root) => { if (root) { await s.refreshState(); s.newThread(root); } }).catch((error) => toast.error(error.message)); };
  const addFolders = () => { if (!s.project) return; const root = s.project; void s.hub.call<string[]>('pickFolders').then(async (folders) => { if (!folders.length) return; const state = await s.hub.call<import('@/types').HubState>('state'); const owner = state.projects.find((project) => project.path === root); if (!owner) return; await s.hub.call('setProjectFolders', root, [...(owner.folders || []), ...folders]); await s.refreshState(); }).catch((error) => toast.error(error.message)); };
  const shortcutActions: Record<string, ShortcutAction> = { 'Command palette': 'search', 'Search in files': 'search-project', 'New chat': 'new', 'Open recent…': 'recent', Settings: 'settings', 'Project sidebar': 'sidebar', Workspace: 'workspace', Terminal: 'terminal', 'Project room': 'room', 'Agent teams': 'team', 'Live activity': 'activity', 'Keyboard shortcuts': 'help', Debugger: 'debug', 'Focus workspace': 'zoom-workspace', 'Restore layout': 'zoom-workspace', 'Full screen': 'fullscreen', 'Exit full screen': 'fullscreen' };
  const editKeys: Record<string, string[]> = { Undo: ['Mod', 'Z'], Redo: platform === 'mac' ? ['Mod', 'Shift', 'Z'] : ['Mod', 'Y'], Cut: ['Mod', 'X'], Copy: ['Mod', 'C'], Paste: ['Mod', 'V'], 'Select all': ['Mod', 'A'], 'Find in file': ['Mod', 'F'], 'Replace in file': platform === 'mac' ? ['Mod', 'Alt', 'F'] : ['Mod', 'H'] };
  const item = (label: string, action: () => void, disabled = false) => <Menubar.Item key={label} disabled={disabled} onSelect={action} className="flex min-h-8 cursor-default items-center gap-6 rounded px-2.5 text-[13px] outline-none data-highlighted:bg-accent data-disabled:opacity-40"><span className="flex-1">{label}</span>{shortcutActions[label] ? <ShortcutLabel action={shortcutActions[label]} /> : editKeys[label] ? <ShortcutKeys keys={editKeys[label]} platform={platform} /> : null}</Menubar.Item>;
  const menu = (label: string, children: React.ReactNode) => <Menubar.Menu><Menubar.Trigger className="h-7 rounded px-2 text-xs text-muted-foreground outline-none hover:bg-muted data-[state=open]:bg-muted focus-visible:ring-1 focus-visible:ring-ring">{label}</Menubar.Trigger><Menubar.Portal><Menubar.Content align="start" sideOffset={4} className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">{children}</Menubar.Content></Menubar.Portal></Menubar.Menu>;
  const edit = (action: string) => {
    // Let application editors handle their own history; native text inputs keep the OS edit commands.
    const target = editTarget.current?.deref();
    if (target?.isConnected) target.focus({ preventScroll: true });
    if (document.activeElement?.closest('.cm-editor')) window.dispatchEvent(new CustomEvent('tributary:editor-command', { detail: action }));
    else if (action === 'find' || action === 'replace') toast.info('Focus a code file to find or replace text.');
    else void s.hub.call('editAction', action).catch((error: Error) => toast.error(error.message));
  };
  return <div role="banner" aria-label="Application title bar" className="desktop-titlebar flex h-8 shrink-0 select-none items-center gap-0.5 border-b bg-sidebar px-1 text-xs" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
    <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button className="titlebar-button" aria-label="Previous chat" disabled={position.current < 1} onClick={() => void navigate(-1)}><ArrowLeft /></button>
      <button className="titlebar-button" aria-label="Next chat" disabled={position.current >= history.current.length - 1} onClick={() => void navigate(1)}><ArrowRight /></button>
      <Tooltip><TooltipTrigger asChild><button className="titlebar-button" aria-label="Toggle project sidebar" onClick={toggleSidebar}><PanelLeft /></button></TooltipTrigger><TooltipContent>Project sidebar <ShortcutLabel action="sidebar" /></TooltipContent></Tooltip>
      <Menubar.Root className="flex items-center" aria-label="Application menu" onPointerDownCapture={() => { if (document.activeElement instanceof HTMLElement && document.activeElement.matches('input,textarea,[contenteditable=true]')) editTarget.current = new WeakRef(document.activeElement); }} onFocusCapture={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.matches('input,textarea,[contenteditable=true]')) editTarget.current = new WeakRef(event.relatedTarget); }}>
        {menu('File', <>{item('New chat', () => s.newThread(), !s.project)}{item('Open project…', () => { void s.hub.call<string | null>('pickProject').then(async (path) => { if (path) { await s.refreshState(); s.newThread(path); } }).catch((e) => toast.error(e.message)); })}{item('Open workspace…', openWorkspace)}{item('Add folders to workspace…', addFolders, !s.project)}{item('Save workspace as…', () => { if (s.project) void s.hub.call('saveWorkspace', s.project).catch((error) => toast.error(error.message)); }, !s.project)}{item('Open recent…', () => s.setRecentOpen(true))}{item('Settings', () => s.openSettings('connections'))}</>)}
        {menu('Edit', <>{['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map((action) => item(action === 'selectAll' ? 'Select all' : action[0].toUpperCase() + action.slice(1), () => edit(action)))}<Menubar.Separator className="my-1 h-px bg-border" />{item('Find in file', () => edit('find'))}{item('Replace in file', () => edit('replace'))}{item('Search in files', () => window.dispatchEvent(new Event('tributary:search-project')), !s.project)}</>)}
        {menu('View', <>{item('Command palette', () => s.setPalette(true))}{item('Search in files', () => window.dispatchEvent(new Event('tributary:search-project')), !s.project)}{item('Project sidebar', toggleSidebar)}{item('Workspace', () => { s.setWorkspaceExpanded(false); s.openPanel('files'); }, !s.project)}{item(s.workspaceExpanded ? 'Restore layout' : 'Focus workspace', () => { s.setWorkspaceExpanded(!s.panel.open || !s.workspaceExpanded); s.openPanel(s.panel.tab); }, !s.project)}{item(fullscreen.active ? 'Exit full screen' : 'Full screen', () => void fullscreen.toggle())}{item('Test results', () => s.openPanel('tests'), !s.project)}{item('Debugger', () => s.setDebugOpen(!s.debugOpen), !s.project)}{item('Terminal', () => s.setTerminalOpen(!s.terminalOpen), !s.project)}{item('Project room', () => s.setRoomOpen(true))}{item('Agent teams', () => s.setTeamOpen(true), !s.project)}{item('Live activity', () => window.dispatchEvent(new Event('tributary:live')))}{item('Keyboard shortcuts', () => s.setShortcutsOpen(true))}</>)}
        {menu('Help', <>{item('Check for updates…', () => { s.openSettings('about'); void s.hub.call('checkForUpdates').catch((error: Error) => toast.error(error.message)); })}{item('About Tributary', () => s.openSettings('about'))}</>)}
      </Menubar.Root>
    </div>
    <Tooltip><TooltipTrigger asChild><button aria-label="Search commands and chats" className="titlebar-command-center mx-auto flex h-6 min-w-0 items-center justify-center gap-2 rounded border border-border/70 bg-background/50 px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => s.setPalette(true)} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><Search className="size-3 shrink-0" /><span className="min-w-0 truncate">{s.st?.projects.find((p) => p.path === s.project)?.name || 'Search commands'}</span><span className="titlebar-command-shortcut ml-auto shrink-0"><ShortcutLabel action="search" /></span></button></TooltipTrigger><TooltipContent>Command palette <ShortcutLabel action="search" /></TooltipContent></Tooltip>
    <div className="ml-auto flex h-full items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <Tooltip><TooltipTrigger asChild><button className="titlebar-window-button" aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'} onClick={() => void fullscreen.toggle()}>{fullscreen.active ? <Minimize /> : <Maximize />}</button></TooltipTrigger><TooltipContent>{fullscreen.active ? 'Exit full screen' : 'Full screen'} <ShortcutLabel action="fullscreen" /></TooltipContent></Tooltip>
      <button className="titlebar-window-button" aria-label="Minimize window" onClick={() => windowAction('minimize')}><Minus /></button>
      <button className="titlebar-window-button" aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => windowAction('maximize')}>{maximized ? <Copy /> : <Square />}</button>
      <button className="titlebar-window-button hover:bg-destructive hover:text-destructive-foreground" aria-label="Close window" onClick={() => windowAction('close')}><X /></button>
    </div>
  </div>;
}
