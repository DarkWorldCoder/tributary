import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Plus, SquareTerminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { hub, useStore } from '@/store';

// One listener per event type, routed to the terminal that owns the output.
const sinks = new Map<string, (d: string) => void>();
const exits = new Map<string, (code: number) => void>();
let wired = false;
function wire() {
  if (wired) return; wired = true;
  hub.on('term-data', ({ id, data }) => sinks.get(id)?.(data));
  hub.on('term-exit', ({ id, code }) => exits.get(id)?.(code));
}
let pendingCommand: string | null = null;
const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function XtermView({ id, active, onExit }: { id: string; active: boolean; onExit: (code: number) => void }) {
  const host = React.useRef<HTMLDivElement>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  React.useEffect(() => {
    const term = new Terminal({
      fontFamily: cssVar('--font-mono', 'monospace'), fontSize: 13, lineHeight: 1.2, cursorBlink: true, allowProposedApi: true, scrollback: 10000,
      theme: { background: cssVar('--card', '#1e1e1e'), foreground: cssVar('--foreground', '#ddd'), cursor: cssVar('--foreground', '#ddd'), selectionBackground: '#4f46e555' },
    });
    const fit = new FitAddon(); fitRef.current = fit;
    term.loadAddon(fit); term.loadAddon(new WebLinksAddon((_e, uri) => hub.call('openExternal', uri)));
    term.open(host.current!);
    try { const gl = new WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl); } catch { /* falls back to the DOM renderer */ }
    sinks.set(id, (d) => term.write(d));
    exits.set(id, (code) => { term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`); onExit(code); });
    const sub = term.onData((d) => hub.call('termWrite', id, d).catch(() => {}));
    const resize = () => { try { fit.fit(); hub.call('termResize', id, term.cols, term.rows).catch(() => {}); } catch { /* not visible */ } };
    const ro = new ResizeObserver(resize); ro.observe(host.current!); resize();
    return () => { ro.disconnect(); sub.dispose(); sinks.delete(id); exits.delete(id); term.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  React.useEffect(() => { if (active) setTimeout(() => fitRef.current?.fit(), 0); }, [active]);
  return <div ref={host} className={cn('h-full w-full px-2 pt-1', !active && 'hidden')} />;
}

export function TerminalPanel() {
  const s = useStore();
  const [terms, setTerms] = React.useState<{ id: string; title: string; done?: boolean }[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(() => { try { return Number(localStorage.getItem('tributary.termHeight')) || 260; } catch { return 260; } });
  const desktop = s.hub.platform === 'desktop';
  const create = React.useCallback(async (command?: string) => {
    wire();
    const id = await s.hub.call<string>('createTerminal', { cwd: s.project, command });
    setTerms((t) => [...t, { id, title: command ? command.split(' ')[0] : `Terminal ${t.length + 1}` }]); setActive(id);
  }, [s.hub, s.project]);
  // The first terminal opens with the panel, running a pending setup command if there is one.
  React.useEffect(() => { if (desktop && !terms.length) { const c = pendingCommand; pendingCommand = null; create(c ?? undefined); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  React.useEffect(() => {
    const h = (e: Event) => { pendingCommand = null; create((e as CustomEvent<string>).detail); };
    window.addEventListener('tributary:run-in-terminal', h); return () => window.removeEventListener('tributary:run-in-terminal', h);
  }, [create]);
  const kill = (id: string) => { s.hub.call('termKill', id).catch(() => {}); setTerms((t) => { const rest = t.filter((x) => x.id !== id); if (active === id) setActive(rest[rest.length - 1]?.id ?? null); return rest; }); };
  const drag = (e: React.PointerEvent) => {
    const y0 = e.clientY; const h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.min(Math.max(120, h0 + (y0 - ev.clientY)), Math.round(window.innerHeight * 0.75)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('tributary.termHeight', String(height)); } catch { /* ignore */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <section aria-label="Terminal" className="relative flex shrink-0 flex-col border-t bg-card" style={{ height }}>
      <div role="separator" aria-orientation="horizontal" aria-label="Resize terminal" onPointerDown={drag} className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-brand/30" />
      <header className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <SquareTerminal className="size-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {terms.map((t) => (
            <div key={t.id} className={cn('group flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-xs', t.id === active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
              <button onClick={() => setActive(t.id)}>{t.title}{t.done ? ' (ended)' : ''}</button>
              <button onClick={() => kill(t.id)} aria-label={`Close ${t.title}`} className="grid size-4 place-items-center rounded opacity-60 hover:bg-background hover:opacity-100"><X className="size-3" /></button>
            </div>
          ))}
        </div>
        {desktop && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => create()} aria-label="New terminal"><Plus /></Button></TooltipTrigger><TooltipContent>New terminal</TooltipContent></Tooltip>}
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => s.setTerminalOpen(false)} aria-label="Hide terminal"><X /></Button></TooltipTrigger><TooltipContent>Hide (Ctrl+`)</TooltipContent></Tooltip>
      </header>
      <div className="min-h-0 flex-1">
        {desktop ? terms.map((t) => <XtermView key={t.id} id={t.id} active={t.id === active} onExit={() => setTerms((x) => x.map((y) => (y.id === t.id ? { ...y, done: true } : y)))} />)
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
