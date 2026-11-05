import * as React from 'react';
import { Search, X } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileTypeIcon } from '@/components/file-type-icon';
import { SearchLabel } from '@/components/search-label';
import { readRecentFiles } from '@/lib/recent-work.mjs';
import { useStore } from '@/store';

/** Keep filename search independent from the Explorer's tree and filter state. */
export function QuickOpen() {
  const s = useStore(); const project = s.workdir;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [matches, setMatches] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const show = () => { setQuery(''); setMatches([]); setError(''); setOpen(true); };
    window.addEventListener('tributary:quick-open', show);
    return () => window.removeEventListener('tributary:quick-open', show);
  }, []);
  React.useEffect(() => {
    let alive = true; setMatches([]); setError('');
    if (!open || !project || !query.trim()) { setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      s.hub.call<string[]>('findFiles', project, query, { showHidden: true })
        .then((files) => { if (alive) setMatches(files.slice(0, 100)); })
        .catch((cause: Error) => { if (alive) setError(cause.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); })
        .finally(() => { if (alive) setBusy(false); });
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, project, query, s.hub]);
  const recent = React.useMemo(() => readRecentFiles().filter((file) => file.project === s.project && (!file.threadId || file.threadId === s.thread?.id)).map((file) => file.rel), [open, s.project, s.thread?.id]);
  const files = query.trim() ? matches : [...new Set(recent)].slice(0, 20);
  return <CommandDialog open={open} onOpenChange={setOpen} title="Quick Open" description="Find and open a file in the current project." className="feature-finder file-picker" commandProps={{ shouldFilter: false }}>
    <div className="flex items-center gap-1 pr-1"><CommandInput leading={<Search className="size-4 text-muted-foreground" />} value={query} onValueChange={setQuery} maxLength={512} placeholder="Search files by name…" aria-label="Search project filenames" /><button aria-label="Close Quick Open" onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground max-sm:size-11 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button></div>
    <div role="status" className="px-3 pt-1 text-xs text-muted-foreground">{busy ? 'Searching files…' : !project ? 'Open a project folder to search files.' : error || (query.trim() ? `${files.length}${files.length === 100 ? '+' : ''} ${files.length === 1 ? 'file' : 'files'}` : 'Recently opened in this project')}</div>
    <CommandList>
      {!busy && <CommandEmpty>{query.trim() ? 'No files match this name.' : 'Type a filename to search this project.'}</CommandEmpty>}
      {!!files.length && <CommandGroup>{files.map((rel) => {
        const parts = rel.split('/'); const name = parts.pop() || rel;
        return <CommandItem key={rel} value={rel} onSelect={() => { setOpen(false); s.openFile(rel, undefined, 'pinned', undefined, false, project || undefined); }}><FileTypeIcon path={rel} /><span className="min-w-0 shrink-0 max-w-[60%] truncate"><SearchLabel text={name} query={query} source={rel} offset={rel.length - name.length} /></span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground"><SearchLabel text={parts.join('/') || './'} query={parts.length ? query : ''} source={rel} /></span></CommandItem>;
      })}</CommandGroup>}
    </CommandList>
    <div className="sr-only"><span>↑ ↓ to navigate · Enter to open</span><span>Esc to close</span></div>
  </CommandDialog>;
}
