import * as React from 'react';
import { CaseSensitive, ChevronDown, ChevronRight, ChevronsDownUp, Ellipsis, RefreshCw, Regex, WholeWord, X } from 'lucide-react';
import { useStore } from '@/store';
import { FileTypeIcon } from '@/components/file-type-icon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShortcutLabel } from '@/components/shortcut-settings';
import { cn } from '@/lib/utils';

type Match = { rel: string; line: number; column: number; text: string; matchStart: number; matchLength: number };
type Result = { matches: Match[]; truncated: boolean };
export function ProjectSearchLauncher() {
  const s = useStore();
  React.useEffect(() => {
    const show = () => { if (!s.project) return; s.setSearchFilesOpen(true); s.setDebugOpen(false); s.openPanel('files'); };
    window.addEventListener('tributary:search-project', show);
    return () => window.removeEventListener('tributary:search-project', show);
  }, [s.project, s.setSearchFilesOpen, s.setDebugOpen, s.openPanel]);
  return null;
}

/** Search View layout is based on VS Code's open-source searchview/searchWidget.
 * This uses Tributary's bounded file search, not a second editor/workbench runtime. */
export function ProjectSearch({ project, visible, onClose, onOpen }: { project: string; visible: boolean; onClose: () => void; onOpen: (rel: string, line: number, column: number) => void }) {
  const s = useStore();
  const input = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState({ caseSensitive: false, wholeWord: false, regexp: false });
  const [details, setDetails] = React.useState(false);
  const [include, setInclude] = React.useState(''); const [exclude, setExclude] = React.useState('');
  const [result, setResult] = React.useState<Result | null>(null);
  const [collapsed, setCollapsed] = React.useState(new Set<string>());
  const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const revision = React.useRef(0);
  const inFlight = React.useRef(false);
  const live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; ++revision.current; }; }, []);
  React.useEffect(() => { if (visible) input.current?.focus(); }, [visible]);
  React.useEffect(() => {
    const focus = () => { if (visible) { input.current?.focus(); input.current?.select(); } };
    window.addEventListener('tributary:search-project', focus);
    return () => window.removeEventListener('tributary:search-project', focus);
  }, [visible]);
  const invalidate = () => { ++revision.current; setResult(null); setError(''); };
  const search = async () => {
    if (!project || !query.trim() || inFlight.current) return;
    const request = ++revision.current; inFlight.current = true; setBusy(true); setError(''); setResult(null);
    try {
      const next = await s.hub.call<Result>('searchProject', project, query, { ...options, include, exclude, detail: true });
      if (live.current && request === revision.current) { setResult(next); setCollapsed(new Set()); }
    } catch (cause) { if (live.current && request === revision.current) setError((cause as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  };
  const grouped = React.useMemo(() => {
    const files = new Map<string, Match[]>();
    for (const match of result?.matches || []) { const rows = files.get(match.rel) || []; rows.push(match); files.set(match.rel, rows); }
    return [...files].sort(([a], [b]) => a.localeCompare(b));
  }, [result]);
  const toggleFile = (rel: string) => setCollapsed((previous) => { const next = new Set(previous); if (next.has(rel)) next.delete(rel); else next.add(rel); return next; });
  return <section className="workspace-search flex h-full min-h-0 flex-col" aria-label="Search in files" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="workbench-toolbar shrink-0 gap-0.5 px-3"><h2 className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase">Search</h2>
      <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Refresh search" disabled={busy || !query.trim()} onClick={() => void search()}><RefreshCw /></Button></TooltipTrigger><TooltipContent>Refresh search</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Collapse search results" disabled={!grouped.length} onClick={() => setCollapsed(collapsed.size === grouped.length ? new Set() : new Set(grouped.map(([rel]) => rel)))}><ChevronsDownUp /></Button></TooltipTrigger><TooltipContent>Collapse / expand results</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Close search sidebar" onClick={onClose}><X /></Button></TooltipTrigger><TooltipContent>Close search · Esc</TooltipContent></Tooltip>
    </header>
    <form className="shrink-0 px-3 pt-1 pb-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <div className="search-query-box flex h-[27px] min-w-0 items-center rounded-sm border bg-input px-1 focus-within:outline-1 focus-within:outline-ring">
        <input ref={input} aria-label="Search project text" placeholder="Search" className="w-0 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none" maxLength={512} value={query} onChange={(event) => { invalidate(); setQuery(event.target.value); }} />
        {([{ key: 'caseSensitive', label: 'Match Case', icon: CaseSensitive }, { key: 'wholeWord', label: 'Match Whole Word', icon: WholeWord }, { key: 'regexp', label: 'Use Regular Expression', icon: Regex }] as const).map(({ key, label, icon: Icon }) => <Tooltip key={key}><TooltipTrigger asChild><button type="button" aria-label={label} aria-pressed={options[key]} onClick={() => { invalidate(); setOptions({ ...options, [key]: !options[key] }); }} className={cn('grid size-[22px] shrink-0 place-items-center rounded-sm border border-transparent hover:bg-accent focus-visible:outline-1 focus-visible:outline-ring', options[key] && 'border-ring bg-accent')}><Icon className="size-4" /></button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>)}
      </div>
      <div className="flex items-center justify-between gap-1 pt-1"><span className="truncate text-[11px] text-muted-foreground" title={project}>{project.split(/[\\/]/).at(-1)}</span><Tooltip><TooltipTrigger asChild><button className="grid size-6 place-items-center rounded hover:bg-accent focus-visible:outline-1 focus-visible:outline-ring" type="button" aria-label="Toggle search details" aria-expanded={details} onClick={() => setDetails(!details)}><Ellipsis className="size-4" /></button></TooltipTrigger><TooltipContent>Files to include / exclude</TooltipContent></Tooltip></div>
      {details && <div className="space-y-2 pb-1 text-[11px]">{([{ label: 'files to include', value: include, set: setInclude, placeholder: '*.ts, src/**' }, { label: 'files to exclude', value: exclude, set: setExclude, placeholder: '*.test.ts' }]).map((filter) => <label className="block space-y-1" key={filter.label}><span>{filter.label}</span><input className="h-[26px] w-full rounded-sm border bg-input px-1.5 text-[12px] outline-none focus:outline-1 focus:outline-ring" aria-label={filter.label} placeholder={filter.placeholder} maxLength={512} value={filter.value} onChange={(event) => { invalidate(); filter.set(event.target.value); }} /></label>)}</div>}
      <button type="submit" className="sr-only" disabled={busy}>Search files</button>
    </form>
    <div className="shrink-0 px-4 pb-2 text-[12px] text-muted-foreground" role="status">{busy ? 'Searching…' : result ? `${result.matches.length} ${result.matches.length === 1 ? 'result' : 'results'} in ${grouped.length} ${grouped.length === 1 ? 'file' : 'files'}${result.truncated ? ' · Limit reached' : ''}` : 'Press Enter to search.'}</div>
    {error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p>}
    <div className="min-h-0 flex-1 overflow-auto pb-2" role="region" aria-label="Project search results">
      {result && !result.matches.length && <p className="px-4 py-2 text-xs text-muted-foreground">No results found. Try another search or check your filters.</p>}
      {grouped.map(([rel, matches]) => <div key={rel}>
        <button type="button" className="search-result-file flex h-[22px] w-full items-center gap-1 px-2 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-1 focus-visible:outline-ring" title={rel} aria-expanded={!collapsed.has(rel)} onClick={() => toggleFile(rel)}>
          {collapsed.has(rel) ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}<FileTypeIcon path={rel} /><span className="truncate">{rel.split('/').at(-1)}</span><span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''}</span><span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{matches.length}</span>
        </button>
        {!collapsed.has(rel) && matches.map((match) => <button type="button" key={`${match.line}:${match.column}`} className="search-result-line flex h-[22px] w-full items-center gap-1 overflow-hidden pr-3 pl-8 text-left text-[12px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-1 focus-visible:outline-ring" title={`${rel}:${match.line}:${match.column} · ${match.text}`} onClick={() => onOpen(rel, match.line, match.column)}>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{match.line}</span><span className="min-w-0 truncate whitespace-pre">{match.text.slice(0, match.matchStart)}<mark className="rounded-sm bg-warning/25 text-inherit outline-1 outline-warning/30">{match.text.slice(match.matchStart, match.matchStart + match.matchLength) || ' '}</mark>{match.text.slice(match.matchStart + match.matchLength)}</span>
        </button>)}
      </div>)}
    </div>
    <footer className="shrink-0 border-t px-3 py-2 text-[10px] text-muted-foreground"><span title="Search skips dependency/build folders, binary files and symbolic links. Searches saved files; unsaved editor drafts are excluded.">Saved files · dependencies excluded</span><span className="sr-only"><ShortcutLabel action="search-project" /></span></footer>
  </section>;
}
