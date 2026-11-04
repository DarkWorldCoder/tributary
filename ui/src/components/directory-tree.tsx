import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import * as React from 'react';
import { ChevronRight, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FolderTypeIcon } from '@/components/folder-type-icon';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { HubBridge } from '@/types';
import type { FileDecoration } from '@/lib/explorer-decorations.mjs';

type OpenIntent = 'preview' | 'pinned';
type TreeState = { expanded: Set<string>; toggle: (path: string) => void; loading?: string | null; revision: number };
interface Entry { name: string; rel: string; directory: boolean; symlink: boolean }
interface Page { entries: Entry[]; next: number | null; total: number }
interface TreeOptions extends TreeState {
  bridge: HubBridge; project: string; active: string | null; openFile: (path: string, intent?: OpenIntent) => void;
  hidden: boolean; sticky: boolean; compact: boolean; chains: Map<string, string[]>;
  decorations?: { files: Map<string, FileDecoration>; folders: Set<string> };
  reviewFile?: (rel: string) => void;
  peek: (rel: string) => Promise<Page>;
}
function Directory({ options, rel, name, parent = '', depth = 0 }: { options: TreeOptions; rel: string; name: string; parent?: string; depth?: number }) {
  const { bridge, project, hidden, active, openFile, expanded: folders, toggle, loading, revision, compact, chains, peek, sticky } = options;
  const [chain, setChain] = React.useState<string[]>([rel]);
  const folder = chain.at(-1) || rel;
  const expanded = rel === '' || folders.has(folder) || chain.some((path) => folders.has(path));
  const [page, setPage] = React.useState<(Page & { rel: string }) | null>(null);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const current = React.useRef(page); current.current = page;
  const sequence = React.useRef(0);
  React.useEffect(() => {
    let alive = true;
    const candidates = compact && rel ? chains.get(rel) : null;
    if (!candidates) { setChain((old) => old.length === 1 && old[0] === rel ? old : [rel]); return; }
    // The file index only suggests chains. Verify every step against the visible directory,
    // so ignored files, empty folders and symlinks cannot be hidden by compaction.
    void (async () => {
      const resolved = [rel];
      for (const child of candidates.slice(1)) {
        const listing = await peek(resolved.at(-1)!);
        if (!alive || listing.next != null || listing.entries.length !== 1 || !listing.entries[0].directory || listing.entries[0].symlink || listing.entries[0].rel !== child) break;
        resolved.push(child);
      }
      if (alive) setChain((old) => old.join('/') === resolved.join('/') ? old : resolved);
    })().catch(() => { if (alive) setChain([rel]); });
    return () => { alive = false; };
  }, [compact, chains, rel, peek]);
  const load = React.useCallback(async (offset = 0) => {
    const request = ++sequence.current; const previous = current.current?.rel === folder ? current.current : null;
    if (!previous || offset) setBusy(true); setError('');
    try {
      let result = await bridge.call<Page>('readDirectory', project, folder, { showHidden: hidden, offset, limit: 200 }); let entries = result.entries;
      if (!offset) {
        const count = previous?.entries.length || 0;
        while (result.next != null && entries.length < count && request === sequence.current) {
          result = await bridge.call<Page>('readDirectory', project, folder, { showHidden: hidden, offset: result.next, limit: 200 }); entries = [...entries, ...result.entries];
        }
      } else entries = [...(previous?.entries || []), ...entries];
      if (request !== sequence.current) return;
      const next = { ...result, entries, rel: folder };
      setPage((old) => old?.rel === folder && old.next === next.next && old.total === next.total && old.entries.length === entries.length && old.entries.every((e, i) => e.rel === entries[i].rel && e.name === entries[i].name && e.directory === entries[i].directory && e.symlink === entries[i].symlink) ? old : next);
    } catch (e) { if (request === sequence.current) setError((e as Error).message); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [bridge, project, folder, hidden]);
  React.useEffect(() => { if (expanded) void load(); return () => { sequence.current++; }; }, [expanded, revision, load]);
  const shown = page?.rel === folder ? page : null;
  const toggleFolder = () => { for (const path of chain) if (folders.has(path)) toggle(path); if (!expanded) toggle(folder); };
  const label = chain.length > 1 ? `${name}/${folder.slice(rel.length + 1)}` : name;
  return <li role="none">
    {rel && <button role="treeitem" tabIndex={-1} data-tree-path={folder} data-tree-parent={parent} data-tree-label={label} data-tree-depth={depth} aria-level={depth + 1} onClick={toggleFolder} aria-expanded={expanded} title={folder}
      style={{ paddingLeft: 6 + depth * 12, ...(sticky ? { top: `calc(var(--explorer-row-height) * ${depth})` } : {}) }}
      className={cn('explorer-row flex w-full items-center gap-1.5 pr-2 text-left text-[13px] hover:bg-muted/70', sticky && 'sticky z-10 bg-background')}><ChevronRight className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-90')} /><FolderTypeIcon path={folder} open={expanded} /><span className="min-w-0 flex-1 truncate">{label}</span>{options.decorations?.folders.has(folder) && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Contains changed files" />}</button>}
    {expanded && <ul role={rel ? 'group' : 'none'} className={cn('m-0 list-none p-0', rel && 'explorer-children')} style={rel ? { '--explorer-guide-left': `${14 + depth * 12}px` } as React.CSSProperties : undefined}>
      {shown?.entries.map((e) => e.directory ? <Directory key={e.rel} options={options} rel={e.rel} name={e.name} parent={folder} depth={rel ? depth + 1 : 0} /> : <li role="none" key={e.rel}><ContextMenu><ContextMenuTrigger asChild><button role="treeitem" tabIndex={-1} aria-level={(rel ? depth + 1 : 0) + 1} data-tree-path={e.rel} data-tree-parent={folder} data-tree-label={e.name} data-tree-depth={rel ? depth + 1 : 0} title={[e.symlink ? `${e.rel} (symbolic link)` : e.rel, options.decorations?.files.get(e.rel)?.label, options.decorations?.files.get(e.rel)?.dirty ? 'Unsaved' : ''].filter(Boolean).join(' · ')} aria-current={active === e.rel ? 'page' : undefined} aria-selected={active === e.rel} aria-busy={loading === e.rel} onClick={() => openFile(e.rel, 'preview')} onDoubleClick={() => openFile(e.rel, 'pinned')} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); openFile(e.rel, 'pinned'); } }} style={{ paddingLeft: 28 + (rel ? depth + 1 : 0) * 12 }} className={cn('explorer-row flex w-full items-center gap-1.5 pr-2 text-left text-[13px] hover:bg-muted/70', active === e.rel && 'bg-accent text-accent-foreground')}>{e.symlink ? <LinkIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileTypeIcon path={e.rel} />}<span className="min-w-0 flex-1 truncate">{e.name}</span>{options.decorations?.files.get(e.rel)?.dirty && <span aria-label="Unsaved" className="size-1.5 shrink-0 rounded-full bg-foreground" />}{options.decorations?.files.get(e.rel)?.code && <span aria-label={options.decorations.files.get(e.rel)?.label} className={cn('shrink-0 font-mono text-[11px]', options.decorations.files.get(e.rel)?.code === 'A' ? 'text-success' : options.decorations.files.get(e.rel)?.code === 'D' ? 'text-destructive' : 'text-warning')}>{options.decorations.files.get(e.rel)?.code}</span>}</button></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => openFile(e.rel, 'pinned')}>Open file</ContextMenuItem>{options.reviewFile && <ContextMenuItem onSelect={() => options.reviewFile?.(e.rel)}>View file changes</ContextMenuItem>}</ContextMenuContent></ContextMenu></li>)}
      {busy && !shown && <li role="none" className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><Spinner className="size-3" />Loading folder…</li>}
      {error && <li role="none" className="px-3 py-2"><p role="alert" className="text-xs text-destructive">{error}</p><Button variant="ghost" size="xs" onClick={() => void load()}>Try again</Button></li>}
      {shown && !shown.entries.length && <li role="none" className="px-5 py-1 text-xs text-muted-foreground">Empty folder</li>}
      {shown?.next != null && <li role="none"><Button variant="ghost" size="xs" disabled={busy} onClick={() => void load(shown.next!)}>Show more ({shown.total - shown.entries.length} remaining)</Button></li>}
    </ul>}
  </li>;
}
export function DirectoryTree({ bridge, project, active, openFile, revision, expanded, toggle, loading, hidden = false, compact = true, sticky = true, chains = new Map(), decorations, reviewFile }: { reviewFile?: (rel: string) => void; decorations?: TreeOptions['decorations']; bridge: HubBridge; project: string; active: string | null; openFile: (path: string, intent?: OpenIntent) => void; hidden?: boolean; compact?: boolean; sticky?: boolean; chains?: Map<string, string[]> } & TreeState) {
  const tree = React.useRef<HTMLUListElement>(null);
  const focusPath = React.useRef(''); const typing = React.useRef({ text: '', at: 0 });
  const peek = React.useMemo(() => { const cache = new Map<string, Promise<Page>>(); return (rel: string) => { if (!cache.has(rel)) cache.set(rel, bridge.call<Page>('readDirectory', project, rel, { showHidden: hidden, limit: 2 })); return cache.get(rel)!; }; }, [bridge, project, revision, hidden]);
  const rows = () => [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || [])];
  React.useEffect(() => {
    if (!active || !tree.current) return;
    // Reveal only after navigation, never in response to a directory refresh.
    const reveal = () => { const row = rows().find((row) => row.dataset.treePath === active); if (!row) return false; row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; };
    if (reveal()) return;
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); }); observer.observe(tree.current, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 2000); return () => { observer.disconnect(); clearTimeout(timer); };
  }, [active]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const list = rows(); const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]'); if (!target) return;
    const index = list.indexOf(target); let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = list[Math.min(list.length - 1, index + 1)];
    else if (event.key === 'ArrowUp') next = list[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = list[0]; else if (event.key === 'End') next = list.at(-1);
    else if (event.key === 'ArrowRight') { if (target.getAttribute('aria-expanded') === 'false') target.click(); else if (list[index + 1]?.dataset.treeParent === target.dataset.treePath) next = list[index + 1]; }
    else if (event.key === 'ArrowLeft') { if (target.getAttribute('aria-expanded') === 'true') target.click(); else next = list.find((row) => row.dataset.treePath === target.dataset.treeParent); }
    else if (event.key.length === 1 && event.key !== ' ') {
      const now = Date.now(); typing.current = { text: now - typing.current.at < 700 ? typing.current.text + event.key.toLowerCase() : event.key.toLowerCase(), at: now };
      next = [...list.slice(index + 1), ...list.slice(0, index + 1)].find((row) => row.dataset.treeLabel?.toLowerCase().startsWith(typing.current.text));
    } else return;
    event.preventDefault(); event.stopPropagation(); next?.focus(); next?.scrollIntoView({ block: 'nearest' });
  };
  return <nav aria-label="Folder contents"><ul ref={tree} role="tree" aria-label="Project folders" tabIndex={0} className="m-0 list-none p-0 outline-none" onKeyDown={onKeyDown}
    onFocus={(event) => { if (event.target === event.currentTarget) (rows().find((row) => row.dataset.treePath === focusPath.current) || rows().find((row) => row.dataset.treePath === active) || rows()[0])?.focus(); else focusPath.current = (event.target as HTMLElement).dataset.treePath || ''; }}>
    <Directory key={project} options={{ bridge, project, active, openFile, revision, expanded, toggle, loading, hidden, compact, sticky, chains, peek, decorations, reviewFile }} rel="" name="" />
  </ul></nav>;
}
