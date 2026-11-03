import * as React from 'react';
import { ChevronRight, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FolderTypeIcon } from '@/components/folder-type-icon';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { HubBridge } from '@/types';

type OpenIntent = 'preview' | 'pinned';
type TreeState = { expanded: Set<string>; toggle: (path: string) => void; loading?: string | null };
interface Entry { name: string; rel: string; directory: boolean; symlink: boolean }
interface Page { entries: Entry[]; next: number | null; total: number }
function Directory({ bridge, project, rel, name, hidden, active, openFile, expanded: folders, toggle, loading, depth = 0 }: { bridge: HubBridge; project: string; rel: string; name: string; hidden: boolean; active: string | null; openFile: (p: string, intent?: OpenIntent) => void; depth?: number } & TreeState) {
  const expanded = rel === '' || folders.has(rel); const [page, setPage] = React.useState<Page | null>(null); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const alive = React.useRef(true); React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = React.useCallback(async (offset = 0) => {
    setBusy(true); setError('');
    try { const result = await bridge.call<Page>('readDirectory', project, rel, { showHidden: hidden, offset, limit: 200 }); if (alive.current) setPage((p) => ({ ...result, entries: offset ? [...(p?.entries || []), ...result.entries] : result.entries })); }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }, [bridge, project, rel, hidden]);
  React.useEffect(() => { if (expanded && !page && !busy && !error) load(); }, [expanded, page, busy, error, load]);
  return <li>
    {rel && <button onClick={() => toggle(rel)} aria-expanded={expanded} title={rel} style={{ paddingLeft: 6 + depth * 12 }} className="explorer-row flex w-full items-center gap-1.5 rounded-md min-h-9 max-sm:min-h-11 pr-2 text-left text-[13px] hover:bg-muted/70"><ChevronRight className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-90')} /><FolderTypeIcon path={rel} open={expanded} /><span className="truncate">{name}</span></button>}
    {expanded && <ul className="m-0 list-none p-0">
      {page?.entries.map((e) => e.directory ? <Directory key={e.rel} bridge={bridge} project={project} rel={e.rel} name={e.name} hidden={hidden} active={active} openFile={openFile} expanded={folders} toggle={toggle} loading={loading} depth={rel ? depth + 1 : 0} /> : <li key={e.rel}><button title={e.symlink ? `${e.rel} (symbolic link)` : e.rel} aria-current={active === e.rel ? 'page' : undefined} aria-busy={loading === e.rel} onClick={() => openFile(e.rel, 'preview')} onDoubleClick={() => openFile(e.rel, 'pinned')} style={{ paddingLeft: 20 + (rel ? depth + 1 : 0) * 12 }} className={cn('explorer-row flex w-full items-center gap-1.5 rounded-md min-h-9 max-sm:min-h-11 pr-2 text-left text-[13px] hover:bg-muted/70', active === e.rel && 'bg-accent text-accent-foreground')}>{e.symlink ? <LinkIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileTypeIcon path={e.rel} loading={loading === e.rel} />}<span className="truncate">{e.name}</span></button></li>)}
      {busy && <li className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><Spinner className="size-3" /> Loading folder…</li>}
      {error && <li className="px-3 py-2"><p role="alert" className="text-xs text-destructive">{error}</p><Button variant="ghost" size="xs" onClick={() => load()}>Try again</Button></li>}
      {page && !page.entries.length && <li className="px-5 py-1 text-xs text-muted-foreground">Empty folder</li>}
      {page?.next != null && <li><Button variant="ghost" size="xs" disabled={busy} onClick={() => load(page.next!)}>Show more ({page.total - page.entries.length} remaining)</Button></li>}
    </ul>}
  </li>;
}
export function DirectoryTree({ bridge, project, active, openFile, revision, expanded, toggle, loading, hidden = false }: { bridge: HubBridge; project: string; active: string | null; openFile: (p: string, intent?: OpenIntent) => void; revision: number; hidden?: boolean } & TreeState) {
  return <nav aria-label="Folder contents"><ul className="m-0 list-none p-0"><Directory key={`${project}:${hidden}:${revision}`} bridge={bridge} project={project} rel="" name="" hidden={hidden} active={active} openFile={openFile} expanded={expanded} toggle={toggle} loading={loading} /></ul></nav>;
}
