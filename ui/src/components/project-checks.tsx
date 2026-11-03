import * as React from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, CircleAlert, Info, Play, RefreshCw, Search, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileTypeIcon } from '@/components/file-type-icon';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { ProjectCheckCatalog, ProjectCheckResult, ProjectCheckState, ProjectDiagnostic } from '@/types';

export function ProjectChecks({ project, onClose, onResult, liveDiagnostics = [], staleFiles = [], visible = true }: { project: string; onClose: () => void; onResult: (result: ProjectCheckResult | null) => void; liveDiagnostics?: ProjectDiagnostic[]; staleFiles?: string[]; visible?: boolean }) {
  const s = useStore(); const [catalog, setCatalog] = React.useState<ProjectCheckCatalog | null>(null);
  const [state, setState] = React.useState<ProjectCheckState>({ running: false, toolId: null, result: null });
  const [toolId, setToolId] = React.useState(''); const [error, setError] = React.useState(''); const [tab, setTab] = React.useState('problems');
  const [filter, setFilter] = React.useState('');
  const alive = React.useRef(true); const sequence = React.useRef(0);
  const update = React.useCallback((next: ProjectCheckState) => { setState(next); onResult(next.result); if (next.result && !next.result.diagnostics.length && next.result.code !== 0) setTab('output'); }, [onResult]);
  const load = React.useCallback(async () => {
    const id = ++sequence.current; setError('');
    try { const next = await s.hub.call<ProjectCheckCatalog>('projectCheckTools', project); if (!alive.current || id !== sequence.current) return; setCatalog(next); setToolId((previous) => next.running && next.toolId ? next.toolId : next.tools.some((t) => t.id === previous) ? previous : next.toolId || next.tools.find((t) => t.available)?.id || next.tools[0]?.id || ''); update(next); }
    catch (e) { if (alive.current && id === sequence.current) setError((e as Error).message); }
  }, [project, s.hub, update]);
  React.useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; ++sequence.current; }; }, [load]);
  React.useEffect(() => {
    if (!state.running) return; let pending = false; let disposed = false;
    const timer = setInterval(async () => { if (pending) return; pending = true; try { const next = await s.hub.call<ProjectCheckState>('projectCheckState', project); if (!disposed && alive.current) update(next); } catch (e) { if (!disposed) setError((e as Error).message); } finally { pending = false; } }, 700);
    return () => { disposed = true; clearInterval(timer); };
  }, [state.running, project, s.hub, update]);
  const run = async () => {
    setError(''); setTab('problems'); update({ running: true, toolId, result: null });
    try { const result = await s.hub.call<ProjectCheckResult>('runProjectCheck', project, toolId); if (alive.current) update({ running: false, toolId, result }); }
    catch (e) { if (alive.current) { await load(); setError((e as Error).message); } }
  };
  const result = state.result; const diagnostics = [...liveDiagnostics, ...(result?.diagnostics || []).filter((d) => !staleFiles.includes(d.rel))]; const selected = catalog?.tools.find((t) => t.id === toolId);
  const query = filter.trim().toLowerCase(); const shown = diagnostics.filter((d) => !query || `${d.rel} ${d.message} ${d.source} ${d.severity}`.toLowerCase().includes(query));
  const lastProblem = React.useRef<string | null>(null);
  const visit = (direction: number) => {
    if (!shown.length) return;
    const key = (d: ProjectDiagnostic) => `${d.rel}:${d.line}:${d.column}:${d.message}`;
    const index = shown.findIndex((d) => key(d) === lastProblem.current);
    const next = shown[(index < 0 ? direction > 0 ? 0 : shown.length - 1 : (index + direction + shown.length) % shown.length)];
    lastProblem.current = key(next); s.openFile(next.rel, next.line, 'pinned', next.column);
  };
  const navigation = React.useRef(visit); navigation.current = visit;
  React.useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => { if (event.key !== 'F8' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return; event.preventDefault(); event.stopPropagation(); navigation.current(event.shiftKey ? -1 : 1); };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [visible]);
  const errors = diagnostics.filter((d) => d.severity === 'error').length; const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  return <section aria-label="Project checks" className="@container flex h-full min-h-0 flex-col bg-card">
    <header className="workbench-toolbar gap-2 border-b px-2"><span className="min-w-0 flex-1 text-xs font-medium">Problems{diagnostics.length > 0 && <span className="ml-2 text-muted-foreground tabular-nums">{errors} {errors === 1 ? 'error' : 'errors'} · {warnings} {warnings === 1 ? 'warning' : 'warnings'}</span>}</span><Button size="icon-sm" variant="ghost" className="workbench-action" aria-label="Previous problem" title="Previous problem (Shift+F8)" disabled={!shown.length} onClick={() => visit(-1)}><ChevronUp /></Button><Button size="icon-sm" variant="ghost" className="workbench-action" aria-label="Next problem" title="Next problem (F8)" disabled={!shown.length} onClick={() => visit(1)}><ChevronDown /></Button><Button size="icon-sm" variant="ghost" className="workbench-action" aria-label="Refresh project tools" disabled={state.running} onClick={() => void load()}><RefreshCw /></Button><Button size="icon-sm" variant="ghost" className="workbench-action" aria-label="Close problems" onClick={onClose}><X /></Button></header>
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5"><NativeSelect aria-label="Project check tool" className="w-full min-w-0 flex-1" value={toolId} disabled={state.running || !catalog?.tools.length} onChange={(e) => setToolId(e.target.value)}>{!catalog?.tools.length && <NativeSelectOption value="">{catalog ? 'No project tools found' : 'Finding tools…'}</NativeSelectOption>}{catalog?.tools.map((tool) => <NativeSelectOption key={tool.id} value={tool.id}>{tool.label}{tool.available ? '' : ' · not installed'}</NativeSelectOption>)}</NativeSelect>{state.running ? <Button size="sm" variant="outline" onClick={() => void s.hub.call('stopProjectCheck', project).catch((e: Error) => setError(e.message))}><Square />Stop check</Button> : <Button size="sm" disabled={!selected?.available} onClick={() => void run()} title={selected?.command}><Play />Run</Button>}</div>
    {error && <p role="alert" className="shrink-0 px-3 py-1.5 text-xs text-destructive">{error}</p>}
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
      <div className="flex min-h-7 shrink-0 items-center gap-2 border-b px-2"><TabsList variant="line" aria-label="Check results" className="h-7 gap-0 p-0"><TabsTrigger value="problems" className="px-2 text-xs">Problems</TabsTrigger><TabsTrigger value="output" className="px-2 text-xs">Output</TabsTrigger></TabsList><label className="ml-auto flex min-w-0 max-w-44 items-center gap-1.5 text-muted-foreground"><Search className="size-3.5 shrink-0" /><input aria-label="Filter problems" placeholder="Filter problems" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-7 w-full min-w-0 bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" /></label><span role="status" className="hidden @min-[500px]:block min-w-0 truncate text-xs text-muted-foreground">{state.running ? 'Checking saved files…' : result ? result.stopped ? 'Stopped' : result.code === 0 ? 'Passed' : 'Failed' : 'Saved files'}</span></div>
      <TabsContent value="problems" className="min-h-0 flex-1 overflow-auto">
        {shown.length ? <ul>{shown.map((d, index) => <li key={index}><button className="flex min-h-7 w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11" title={`${d.rel}:${d.line}:${d.column} ${d.message}`} onClick={() => s.openFile(d.rel, d.line, 'pinned', d.column)}>{d.severity === 'error' ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : d.severity === 'info' ? <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />}<span className="min-w-0 flex-1"><span className="line-clamp-2 break-words">{d.message}</span><span className="mt-0.5 flex items-center gap-1.5 text-muted-foreground"><FileTypeIcon path={d.rel} /><span className="truncate">{d.rel}:{d.line}:{d.column}{d.source && ` · ${d.source}`}</span></span></span></button></li>)}</ul> : <div className="flex min-h-24 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">{result?.code === 0 ? <Check className="size-4 text-success" /> : result ? <AlertCircle className="size-4" /> : null}<span>{query && diagnostics.length ? 'No matching problems' : state.running ? 'Checking…' : result ? result.code === 0 ? 'No problems reported' : 'See Output for details' : catalog?.tools.length ? 'Choose a tool to check saved files' : 'Add a lint or check script to this project'}</span></div>}
      </TabsContent>
      <TabsContent value="output" className="min-h-0 flex-1 overflow-auto p-3"><pre className={cn('whitespace-pre-wrap break-words font-mono text-xs', !result && 'text-muted-foreground')}>{result ? `$ ${result.command}\n${result.output || '(no output)'}\n\nExit ${result.code}` : state.running ? 'Output will appear when the check finishes.' : selected?.command || 'No check has run.'}</pre></TabsContent>
    </Tabs>
  </section>;
}
