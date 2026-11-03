import * as React from 'react';
import { Plus, SquareTerminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { XtermView, wire } from '@/components/terminal-view';
import { cn } from '@/lib/utils';
import { hub, useStore } from '@/store';

let pendingCommand: string | null = null;

type Term = { id: string; title: string; project: string | null; done?: boolean; named?: boolean; shellTitle?: string };

/** Terminal tabs per project. Hidden, not unmounted, when the panel is closed, so shells and scrollback survive. */
export function TerminalPanel({ hidden = false }: { hidden?: boolean } = {}) {
  const s = useStore();
  const [terms, setTerms] = React.useState<Term[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(() => { try { return Number(localStorage.getItem('tributary.termHeight')) || 260; } catch { return 260; } });
  const desktop = s.hub.platform === 'desktop';
  const create = React.useCallback(async (command?: string) => {
    wire();
    const id = await s.hub.call<string>('createTerminal', { cwd: s.project, command });
    setTerms((t) => [...t, { id, project: s.project, title: command ? command.split(' ')[0] : `Terminal ${t.filter((x) => x.project === s.project).length + 1}` }]); setActive(id);
  }, [s.hub, s.project]);
  // The first terminal opens with the panel, running a pending setup command if there is one.
  React.useEffect(() => { if (desktop && !terms.length) { const c = pendingCommand; pendingCommand = null; create(c ?? undefined); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  React.useEffect(() => {
    const h = (e: Event) => { pendingCommand = null; create((e as CustomEvent<string>).detail); };
    window.addEventListener('tributary:run-in-terminal', h); return () => window.removeEventListener('tributary:run-in-terminal', h);
  }, [create]);
  const kill = (id: string) => { s.hub.call('termKill', id).catch(() => {}); setTerms((t) => { const rest = t.filter((x) => x.id !== id); const mine = rest.filter((x) => x.project === s.project); if (active === id) setActive(mine[mine.length - 1]?.id ?? null); return rest; }); };
  const visible = terms.filter((t) => t.project === s.project);
  // Each project keeps its own terminals: switching projects shows that project's, starting one if needed.
  React.useEffect(() => {
    if (!desktop || hidden || !terms.length) return;
    if (!visible.length) create(); else if (!visible.some((t) => t.id === active)) setActive(visible[visible.length - 1].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.project, hidden]);
  // Shells end with the panel (closing the window or removing the project), not when it is only hidden.
  const termsRef = React.useRef(terms); termsRef.current = terms;
  React.useEffect(() => () => { for (const t of termsRef.current) hub.call('termKill', t.id).catch(() => {}); }, []);
  React.useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem('tributary.termHeight', String(height)); } catch { /* storage unavailable */ } }, 300); return () => clearTimeout(t); }, [height]);
  const maxHeight = () => Math.round(window.innerHeight * 0.75);
  const rename = (id: string, value: string) => { const v = value.trim(); if (v) setTerms((x) => x.map((y) => (y.id === id ? { ...y, title: v.slice(0, 40), named: true } : y))); setEditing(null); };
  const drag = (e: React.PointerEvent) => {
    const y0 = e.clientY; const h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.min(Math.max(120, h0 + (y0 - ev.clientY)), maxHeight()));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <section aria-label="Terminal" className={cn('relative flex shrink-0 flex-col border-t bg-card', hidden && 'hidden')} style={{ height }}>
      <div role="separator" aria-orientation="horizontal" aria-label="Resize terminal" tabIndex={0} aria-valuenow={height} aria-valuemin={120} aria-valuemax={maxHeight()}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setHeight((h) => Math.min(Math.max(120, h + (e.key === 'ArrowUp' ? 24 : -24)), maxHeight())); } }}
        onPointerDown={drag} className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none hover:bg-brand/30 focus-visible:bg-brand/40" />
      <header className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
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
        {desktop && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => create()} aria-label="New terminal"><Plus /></Button></TooltipTrigger><TooltipContent>New terminal</TooltipContent></Tooltip>}
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => s.setTerminalOpen(false)} aria-label="Hide terminal"><X /></Button></TooltipTrigger><TooltipContent>Hide (Ctrl+`)</TooltipContent></Tooltip>
      </header>
      <div className="min-h-0 flex-1">
        {desktop ? terms.map((t) => (
          <XtermView key={t.id} id={t.id} project={t.project} active={!hidden && t.id === active && t.project === s.project}
            onExit={() => setTerms((x) => x.map((y) => (y.id === t.id ? { ...y, done: true } : y)))}
            onTitle={(title) => setTerms((x) => x.map((y) => (y.id === t.id ? { ...y, shellTitle: title } : y)))}
            onKill={() => kill(t.id)} onOpenFile={(rel, line) => s.openFile(rel, line)} />
        ))
          : <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              {s.hub.platform === 'vscode' ? <Button variant="outline" onClick={() => s.hub.call('createTerminal', { cwd: s.project })}>Open a VS Code terminal in this project</Button> : 'The terminal runs in the desktop app.'}
            </div>}
      </div>
    </section>
  );
}

/** Run a command in a new terminal tab (for sign-in and setup steps), opening the panel if needed. */
export function useRunInTerminal() {
  const s = useStore();
  return React.useCallback((command: string) => {
    if (s.hub.platform === 'vscode') { s.hub.call('createTerminal', { cwd: s.project, command }); return; }
    if (!s.terminalOpen) { pendingCommand = command; s.setTerminalOpen(true); return; }
    window.dispatchEvent(new CustomEvent('tributary:run-in-terminal', { detail: command }));
  }, [s]);
}
