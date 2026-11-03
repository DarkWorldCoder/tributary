import { ShortcutLabel } from '@/components/shortcut-settings';
import * as React from 'react';
import { PanelBottom, PanelLeft, PanelRight, PanelTop, PanelsTopLeft, Plus, SquareTerminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { XtermView, wire } from '@/components/terminal-view';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { hub, useStore } from '@/store';
import { takePendingTerminalCommand } from '@/hooks/use-run-in-terminal';


type Term = { id: string; title: string; project: string | null; done?: boolean; named?: boolean; shellTitle?: string };

/** Terminal tabs per project. Hidden, not unmounted, when the panel is closed, so shells and scrollback survive. */
export function TerminalPanel({ hidden = false }: { hidden?: boolean } = {}) {
  const s = useStore();
  const [terms, setTerms] = React.useState<Term[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(() => { try { return Number(localStorage.getItem('tributary.termHeight')) || 260; } catch { return 260; } });
  const [width, setWidth] = React.useState(() => { try { return Number(localStorage.getItem('tributary.termWidth')) || 420; } catch { return 420; } });
  const section = React.useRef<HTMLElement>(null);
  const cleanupDrag = React.useRef<() => void>(() => {});
  const side = s.terminalDock === 'left' || s.terminalDock === 'right';
  const leading = s.terminalDock === 'left' || s.terminalDock === 'top';
  const [maxSize, setMaxSize] = React.useState(800);
  const minSize = side ? Math.min(240, maxSize) : Math.min(120, maxSize);
  const size = Math.min(maxSize, Math.max(minSize, side ? width : height));
  const desktop = s.hub.platform === 'desktop';
  const creating = React.useRef(new Set<string | null>());
  const create = React.useCallback(async (command?: string, cwd = s.workdir) => {
    wire(); creating.current.add(s.workdir);
    try {
    const id = await s.hub.call<string>('createTerminal', { cwd, command });
    setTerms((t) => [...t, { id, project: s.workdir, title: command ? command.split(' ')[0] : `Terminal ${t.filter((x) => x.project === s.workdir).length + 1}` }]); setActive(id);
    } catch (error) { toast.error((error as Error).message || 'Could not open terminal'); } finally { creating.current.delete(s.workdir); }
  }, [s.hub, s.workdir]);
  // The first terminal opens with the panel, running a pending setup command if there is one.
  React.useEffect(() => { if (desktop && !terms.length) { const pending = takePendingTerminalCommand(); void create(pending?.command, pending?.cwd ?? s.workdir); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  React.useEffect(() => {
    const h = () => { const pending = takePendingTerminalCommand(); if (pending) void create(pending.command, pending.cwd); };
    window.addEventListener('tributary:run-in-terminal', h); return () => window.removeEventListener('tributary:run-in-terminal', h);
  }, [create]);
  const kill = (id: string) => { s.hub.call('termKill', id).catch(() => {}); setTerms((t) => { const rest = t.filter((x) => x.id !== id); const mine = rest.filter((x) => x.project === s.workdir); if (active === id) setActive(mine[mine.length - 1]?.id ?? null); return rest; }); };
  const visible = terms.filter((t) => t.project === s.workdir);
  // Each project keeps its own terminals: switching projects shows that project's, starting one if needed.
  React.useEffect(() => {
    if (!desktop || hidden || !terms.length || creating.current.has(s.workdir)) return;
    if (!visible.length) create(); else if (!visible.some((t) => t.id === active)) setActive(visible[visible.length - 1].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workdir, hidden]);
  // Shells end with the panel (closing the window or removing the project), not when it is only hidden.
  const termsRef = React.useRef(terms); termsRef.current = terms;
  React.useEffect(() => () => { for (const t of termsRef.current) hub.call('termKill', t.id).catch(() => {}); }, []);
  React.useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem('tributary.termHeight', String(height)); } catch { /* storage unavailable */ } }, 300); return () => clearTimeout(t); }, [height]);
  React.useEffect(() => { try { localStorage.setItem('tributary.termWidth', String(width)); } catch { /* optional preference */ } }, [width]);
  React.useEffect(() => {
    const parent = section.current?.parentElement; if (!parent) return;
    const resize = () => { const r = parent.getBoundingClientRect(); setMaxSize(Math.max(80, Math.floor((side ? r.width : r.height) * 0.65))); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(parent);
    return () => observer.disconnect();
  }, [side]);
  React.useEffect(() => () => cleanupDrag.current(), [s.terminalDock]);
  const setSize = (value: number) => (side ? setWidth : setHeight)(Math.min(maxSize, Math.max(minSize, value)));
  const rename = (id: string, value: string) => { const v = value.trim(); if (v) setTerms((x) => x.map((y) => (y.id === id ? { ...y, title: v.slice(0, 40), named: true } : y))); setEditing(null); };
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return; e.preventDefault(); cleanupDrag.current();
    const start = side ? e.clientX : e.clientY; const initial = size;
    const move = (ev: PointerEvent) => setSize(initial + ((side ? ev.clientX : ev.clientY) - start) * (leading ? 1 : -1));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    cleanupDrag.current = up;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  return (
    <section ref={section} aria-label="Terminal" data-position={s.terminalDock} className={cn('relative flex min-h-0 min-w-0 shrink-0 flex-col bg-card', leading && '-order-1', s.terminalDock === 'bottom' ? 'border-t' : s.terminalDock === 'top' ? 'border-b' : s.terminalDock === 'left' ? 'border-r' : 'border-l', hidden && 'hidden')} style={side ? { width: size } : { height: size }}>
      <div role="separator" aria-orientation={side ? 'vertical' : 'horizontal'} aria-label="Resize terminal" tabIndex={0} aria-valuenow={size} aria-valuemin={minSize} aria-valuemax={maxSize}
        onKeyDown={(e) => { const keys = side ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']; if (keys.includes(e.key)) { e.preventDefault(); setSize(size + (e.key === keys[1] ? 24 : -24) * (leading ? 1 : -1)); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSize(e.key === 'Home' ? minSize : maxSize); } }}
        onPointerDown={drag} className={cn('absolute z-10 touch-none outline-none hover:bg-brand/30 focus-visible:bg-brand/40', side ? `inset-y-0 w-2 cursor-col-resize ${leading ? '-right-1' : '-left-1'}` : `inset-x-0 h-2 cursor-row-resize ${leading ? '-bottom-1' : '-top-1'}`)} />
      <header className="workbench-toolbar gap-1 border-b px-2">
        <SquareTerminal className="size-4 text-muted-foreground" />
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {visible.map((t) => (
            <div key={t.id} className={cn('group flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-xs', t.id === active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
              {editing === t.id
                ? <input autoFocus defaultValue={t.title} aria-label="Terminal name" className="w-28 bg-transparent outline-none" onBlur={(e) => rename(t.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = t.title; e.currentTarget.blur(); } }} />
                : <button role="tab" aria-selected={t.id === active} title={t.shellTitle ? `${t.shellTitle} (double-click to rename)` : 'Double-click to rename'} onClick={() => setActive(t.id)} onDoubleClick={() => setEditing(t.id)}
                    className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t.title}{t.done ? ' (ended)' : ''}</button>}
              <button onClick={() => kill(t.id)} aria-label={`Close ${t.title}`} className="grid size-4 place-items-center rounded opacity-60 hover:bg-background hover:opacity-100"><X className="size-3" /></button>
            </div>
          ))}
        </div>
        {desktop && <Tooltip><TooltipTrigger asChild><Button className="workbench-action" variant="ghost" size="icon-sm" onClick={() => create()} aria-label="New terminal"><Plus /></Button></TooltipTrigger><TooltipContent>New terminal</TooltipContent></Tooltip>}
        <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button className="workbench-action" variant="ghost" size="icon-sm" aria-label="Move terminal"><PanelsTopLeft /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Move terminal</TooltipContent></Tooltip>
          <DropdownMenuContent align="end"><DropdownMenuLabel>Terminal position</DropdownMenuLabel><DropdownMenuRadioGroup value={s.terminalPosition} onValueChange={(value) => s.setTerminalPosition(value as typeof s.terminalPosition)}>
            {([['left', 'Left', PanelLeft], ['right', 'Right', PanelRight], ['top', 'Top', PanelTop], ['bottom', 'Bottom', PanelBottom]] as const).map(([value, label, Icon]) => <DropdownMenuRadioItem key={value} value={value}><Icon className="size-4" />{label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <Tooltip><TooltipTrigger asChild><Button className="workbench-action" variant="ghost" size="icon-sm" onClick={() => s.setTerminalOpen(false)} aria-label="Hide terminal"><X /></Button></TooltipTrigger><TooltipContent>Hide <ShortcutLabel action="terminal" /></TooltipContent></Tooltip>
      </header>
      <div className="min-h-0 flex-1">
        {desktop ? terms.map((t) => (
          <XtermView key={t.id} id={t.id} project={t.project} active={!hidden && t.id === active && t.project === s.workdir}
            onExit={() => setTerms((x) => x.map((y) => (y.id === t.id ? { ...y, done: true } : y)))}
            onTitle={(title) => setTerms((x) => x.map((y) => (y.id === t.id ? { ...y, shellTitle: title } : y)))}
            onKill={() => kill(t.id)} onOpenFile={(rel, line) => s.openFile(rel, line)} />
        ))
          : <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              {s.hub.platform === 'vscode' ? <Button variant="outline" onClick={() => s.hub.call('createTerminal', { cwd: s.workdir })}>Open a VS Code terminal in this project</Button> : 'The terminal runs in the desktop app.'}
            </div>}
      </div>
    </section>
  );
}
