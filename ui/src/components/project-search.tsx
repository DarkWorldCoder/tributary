import * as React from 'react';
import { Search } from 'lucide-react';
import { useStore } from '@/store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Result = { matches: { rel: string; line: number; column: number; text: string }[]; truncated: boolean };
export function ProjectSearch() {
  const s = useStore(); const project = s.workdir;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const revision = React.useRef(0);
  React.useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('tributary:search-project', show);
    return () => window.removeEventListener('tributary:search-project', show);
  }, []);
  React.useEffect(() => { ++revision.current; setResult(null); setError(''); setBusy(false); }, [project, open]);
  const search = async () => {
    if (!project || !query.trim() || busy) return;
    const request = ++revision.current; setBusy(true); setError(''); setResult(null);
    try { const next = await s.hub.call<Result>('searchProject', project, query); if (request === revision.current) setResult(next); }
    catch (cause) { if (request === revision.current) setError((cause as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    finally { if (request === revision.current) setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent overlayClassName="bg-transparent! backdrop-filter-none!" className="top-10 flex max-h-[calc(100dvh-56px)] translate-y-0 flex-col rounded-md sm:max-w-2xl">
    <DialogHeader><DialogTitle>Search in files</DialogTitle><DialogDescription>Find text in this project. Case-insensitive; skips dependencies, build output, binary files and symbolic links.</DialogDescription></DialogHeader>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}><Input autoFocus aria-label="Search project text" placeholder="Search project text…" maxLength={512} value={query} onChange={(event) => setQuery(event.target.value)} /><Button disabled={busy || !project || !query.trim()} type="submit"><Search />{busy ? 'Searching…' : 'Search'}</Button></form>
    {!project && <p className="text-sm text-muted-foreground">Open a project folder to search its files.</p>}
    <div aria-live="polite" className="text-xs text-muted-foreground">{busy ? 'Searching project files…' : result ? `${result.matches.length} matching lines${result.truncated ? ' · Limit reached; narrow your search' : ''}` : ''}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="min-h-0 overflow-auto" role="region" aria-label="Project search results">
      {result?.matches.map((match) => <button key={`${match.rel}:${match.line}`} className="block w-full rounded px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" onClick={() => { s.openFile(match.rel, match.line, 'pinned', match.column, false, project || undefined); setOpen(false); }}><span className="flex justify-between gap-2 text-xs"><span className="truncate font-medium">{match.rel}</span><span className="shrink-0 text-muted-foreground">{match.line}:{match.column}</span></span><span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{match.text}</span></button>)}
    </div>
  </DialogContent></Dialog>;
}
