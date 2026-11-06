import * as React from 'react';
import { fileSearch, type FileSearchResult } from '@/lib/file-search.mjs';
import { Search, X } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileTypeIcon } from '@/components/file-type-icon';
import { SearchLabel } from '@/components/search-label';
import { readRecentFiles } from '@/lib/recent-work.mjs';
import { quickOpenQuery } from '@/lib/quick-open-query.mjs';
import { useStore } from '@/store';

/** Keep filename search independent from the Explorer's tree and filter state. */
export function QuickOpen() {
  const s = useStore(); const project = s.workdir;
  const [open, setOpen] = React.useState(false);
  const opened = React.useRef(false); opened.current = open;
  const selected = React.useRef(false);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const input = React.useRef<HTMLInputElement | null>(null);
  // Focus at DOM commit, before the first visible frame accepts typing. Keep
  // stale close callbacks from an interrupted exit from focusing the editor.
  const mountInput = React.useCallback((element: HTMLInputElement | null) => {
    input.current = element;
    if (element && opened.current) element.focus({ preventScroll: true });
  }, []);
  const [query, setQuery] = React.useState('');
  const location = quickOpenQuery(query);
  const filename = location.file;
  const [matches, setMatches] = React.useState<string[]>([]);
  const [coverage, setCoverage] = React.useState<FileSearchResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const show = () => { if (!opened.current && document.activeElement instanceof HTMLElement && !document.activeElement.closest('.file-picker')) returnFocus.current = document.activeElement; selected.current = false; opened.current = true; setQuery(''); setMatches([]); setError(''); setOpen(true); input.current?.focus({ preventScroll: true }); };
    window.addEventListener('tributary:quick-open', show);
    return () => window.removeEventListener('tributary:quick-open', show);
  }, []);
  React.useEffect(() => {
    let alive = true; let cancel: (() => void) | undefined; setMatches([]); setCoverage(null); setError('');
    if (!open || !project || !filename) { setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      const search = fileSearch(s.hub, project, filename, { showHidden: true, limit: 100 }); cancel = search.cancel;
      search.result
        .then((result) => { if (alive) { setMatches(result.files); setCoverage(result); } })
        .catch((cause: Error) => { if (alive) setError(cause.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); })
        .finally(() => { if (alive) setBusy(false); });
    }, 150);
    return () => { alive = false; clearTimeout(timer); cancel?.(); };
  }, [open, project, filename, s.hub]);
  const recent = React.useMemo(() => readRecentFiles().filter((file) => file.project === s.project && (!file.threadId || file.threadId === s.thread?.id)).map((file) => file.rel), [open, s.project, s.thread?.id]);
  const files = filename ? matches : [...new Set(recent)].slice(0, 20);
  return <CommandDialog open={open} onOpenChange={setOpen} onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus({ preventScroll: true }); }} onCloseAutoFocus={(event) => {
    event.preventDefault();
    if (opened.current) { input.current?.focus({ preventScroll: true }); return; }
    const previous = returnFocus.current; returnFocus.current = null;
    const current = document.activeElement;
    // A newer action (for example Find in Files) already owns focus.
    if (current instanceof HTMLElement && current !== document.body && current !== document.documentElement && !current.closest('.file-picker')) return;
    if (!selected.current) {
      const target = previous?.isConnected && previous !== document.body && previous !== document.documentElement ? previous : document.querySelector<HTMLElement>('[data-editor-group][data-focused="true"] .cm-content');
      target?.focus({ preventScroll: true });
    }
  }} title="Quick Open" description="Find and open a file in the current project." className="feature-finder file-picker" commandProps={{ shouldFilter: false }}>
    <div className="flex items-center gap-1 pr-1"><CommandInput ref={mountInput} leading={<Search className="size-4 text-muted-foreground" />} value={query} onValueChange={setQuery} maxLength={512} placeholder="Search files by name (append :line:column)" aria-label="Search project filenames" /><button aria-label="Close Quick Open" onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground max-sm:size-11 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button></div>
    <div role="status" className="flex min-w-0 items-center gap-2 px-3 pt-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{busy ? 'Searching files…' : !project ? 'Open a project folder to search files.' : error || (filename ? `${coverage?.limited ? `${files.length} of ${coverage.total}` : files.length} ${coverage?.total === 1 ? 'file' : 'files'}${coverage?.unreadable ? ` · ${coverage.unreadable} folders unavailable` : ''}` : 'Recently opened in this project')}</span>{location.line !== undefined && <span className="shrink-0 tabular-nums">Line {location.line}:{location.column}</span>}</div>
    <CommandList>
      {!busy && <CommandEmpty>{filename ? 'No files match this name.' : 'Type a filename to search this project.'}</CommandEmpty>}
      {!!files.length && <CommandGroup>{files.map((rel) => {
        const parts = rel.split('/'); const name = parts.pop() || rel;
        return <CommandItem key={rel} value={rel} onSelect={() => { selected.current = true; setOpen(false); s.openFile(rel, location.line, 'pinned', location.column, false, project || undefined); }}><FileTypeIcon path={rel} /><span className="min-w-0 shrink-0 max-w-[60%] truncate"><SearchLabel text={name} query={filename} source={rel} offset={rel.length - name.length} /></span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground"><SearchLabel text={parts.join('/') || './'} query={parts.length ? filename : ''} source={rel} /></span></CommandItem>;
      })}</CommandGroup>}
    </CommandList>
    <div className="sr-only"><span>↑ ↓ to navigate · Enter to open</span><span>Esc to close</span></div>
  </CommandDialog>;
}
