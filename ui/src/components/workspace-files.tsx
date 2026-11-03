import * as React from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, Circle, Ellipsis, Eye, FolderOpen, Image as ImageIcon, PanelLeftClose, PanelLeftOpen, Pencil, Pin, RefreshCw, RotateCw, Save, Search, SquareArrowOutUpRight, WrapText, X } from 'lucide-react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CodeEditor } from '@/components/code-editor';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FolderTypeIcon } from '@/components/folder-type-icon';
import { DirectoryTree } from '@/components/directory-tree';
import { Markdown } from '@/components/markdown';
import { ImagePreview } from '@/components/image-preview';
import { imageMime, imageSource } from '@/lib/image-preview.mjs';
import { closeFileTabs, fileTabLabel, openFileTab } from '@/lib/workspace-tabs.mjs';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { FileContent } from '@/types';

type Node = { name: string; path: string; dir: boolean; children: Node[] };
function buildTree(files: string[]): Node[] {
  const root: Node = { name: '', path: '', dir: true, children: [] };
  for (const f of files) {
    let cur = root; const parts = f.split('/');
    parts.forEach((p, i) => {
      const isDir = i < parts.length - 1; const path = parts.slice(0, i + 1).join('/');
      let n = cur.children.find((c) => c.name === p && c.dir === isDir);
      if (!n) { n = { name: p, path, dir: isDir, children: [] }; cur.children.push(n); }
      cur = n;
    });
  }
  const sort = (n: Node) => { n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root); return root.children;
}
function TreeNode({ n, depth, open, toggle, active, onOpen, loading }: { n: Node; depth: number; open: Set<string>; toggle: (p: string) => void; active: string | null; onOpen: (p: string, intent?: OpenIntent) => void; loading?: string | null }) {
  const isOpen = open.has(n.path);
  return (
    <>
      <button onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))} aria-expanded={n.dir ? isOpen : undefined} aria-current={!n.dir && active === n.path ? 'page' : undefined} aria-busy={!n.dir && loading === n.path} onDoubleClick={() => { if (!n.dir) onOpen(n.path, 'pinned'); }} title={n.path}
        className={cn('explorer-row flex w-full items-center gap-1.5 rounded-md min-h-9 max-sm:min-h-11 pr-2 text-left text-[13px] hover:bg-muted/70', active === n.path && 'bg-accent text-accent-foreground')} style={{ paddingLeft: 6 + depth * 12 }}>
        {n.dir ? <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} /> : <span className="w-3.5 shrink-0" />}
        {n.dir ? <FolderTypeIcon path={n.path} open={isOpen} /> : <FileTypeIcon path={n.path} loading={loading === n.path} />}
        <span className="truncate">{n.name}</span>
      </button>
      {n.dir && isOpen && n.children.map((c) => <TreeNode key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} active={active} onOpen={onOpen} loading={loading} />)}
    </>
  );
}
type OpenIntent = 'preview' | 'pinned';
type Doc = FileContent & { text: string; dirty: boolean; pinned: boolean; mode: 'edit' | 'preview'; diskChanged?: boolean; diskError?: boolean; wrap?: boolean };
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
function FilePreview({ doc, project }: { doc: Doc; project: string }) {
  const html = React.useMemo(() => (/\.html?$/i.test(doc.rel) ? URL.createObjectURL(new Blob([doc.text], { type: 'text/html' })) : null), [doc.rel, doc.text]);
  const src = React.useMemo(() => imageMime(doc.rel) ? imageSource({ ...doc, content: doc.text }) : null, [doc.rel, doc.text, doc.base64, doc.truncated]);
  React.useEffect(() => () => { if (html) URL.revokeObjectURL(html); }, [html]);
  if (imageMime(doc.rel)) return <ImagePreview key={doc.rel} src={src} name={doc.rel} size={doc.size} revision={doc.mtime} unavailable={doc.truncated ? `Image exceeds the ${IMAGE.test(doc.rel) ? '16' : '1'} MB preview limit.` : undefined} />;
  if (/\.(md|mdx|markdown)$/i.test(doc.rel)) return <div role="region" aria-label="File preview" tabIndex={0} className="h-full overflow-auto px-5 py-4"><Markdown text={doc.text} baseFile={doc.rel} project={project} /></div>;
  if (html) return <iframe title={`Preview of ${doc.rel}`} sandbox="" src={html} className="h-full w-full bg-white" />;
  return null;
}
const previewable = (rel: string) => IMAGE.test(rel) || /\.(svg|md|mdx|markdown|html?)$/i.test(rel);

// This component is kept mounted separately for every visited project in this session.
export function FilesTab({ project, visible }: { project: string; visible: boolean }) {
  const s = useStore();
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [directoryRevision, setDirectoryRevision] = React.useState(0);
  const [live, setLive] = React.useState('Connecting…');
  const [watchRevision, setWatchRevision] = React.useState(0);
  const [filter, setFilter] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const searchId = React.useId();
  const [browse, setBrowse] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [cursors, setCursors] = React.useState<Record<string, { line: number; column: number }>>({});
  const [active, setActive] = React.useState<string | null>(null);
  const [line, setLine] = React.useState<number | undefined>();
  const [editors, setEditors] = React.useState<{ id: string; name: string }[]>([]);
  const [error, setError] = React.useState<{ rel: string; intent: OpenIntent; line?: number; reload?: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<{ paths: string[]; reload?: boolean } | null>(null);
  const [small, setSmall] = React.useState(() => window.innerWidth < 640);
  const explorer = React.useRef<PanelImperativeHandle>(null);
  const fileGroup = React.useRef<HTMLDivElement>(null);
  const explorerWidth = React.useRef(200);
  const docsRef = React.useRef(docs); docsRef.current = docs;
  const activeRef = React.useRef(active); activeRef.current = active;
  const sequence = React.useRef(0);
  const requests = React.useRef(new Map<string, Promise<FileContent>>());
  const handledIntent = React.useRef<number | undefined>(undefined);
  const fileTabs = React.useRef<HTMLDivElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const [tabEnds, setTabEnds] = React.useState<{ rel: string; right: number }[]>([]);
  const tabSignature = JSON.stringify(docs.map(({ rel, dirty, pinned }) => [rel, dirty, pinned]));
  const focusActiveTab = () => (fileTabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ?? root.current?.querySelector<HTMLElement>('[aria-label="Open files menu"]'))?.focus({ preventScroll: true });
  const search = React.useRef<HTMLInputElement>(null);
  const searchToggle = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (searchOpen && visible && !collapsed && (!small || browse)) search.current?.focus(); }, [searchOpen, visible, collapsed, small, browse]);
  const restoreFocus = React.useRef<HTMLElement | null>(null);
  const load = React.useCallback(() => { s.hub.call<string[]>('listFiles', project).then(setFiles).catch(() => setFiles([])); }, [project, s.hub]);
  React.useEffect(() => { if (visible) { load(); setDirectoryRevision((value) => value + 1); } }, [visible, load]);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const change = () => setSmall(query.matches); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  React.useEffect(() => {
    if (visible) explorer.current?.resize(small ? browse ? '100%' : 0 : collapsed ? 0 : explorerWidth.current);
  }, [visible, small, browse, collapsed]);
  React.useEffect(() => { if (s.hub.platform === 'desktop') s.hub.call<{ id: string; name: string }[]>('editors').then(setEditors).catch(() => {}); }, [s.hub]);
  React.useLayoutEffect(() => {
    if (!visible || !fileTabs.current) return;
    const measure = () => {
      const ends = [...(fileTabs.current?.querySelectorAll<HTMLElement>('[role="tab"][data-file-path]') ?? [])].map((tab) => ({ rel: tab.dataset.filePath!, right: tab.offsetLeft + tab.offsetWidth }));
      setTabEnds((previous) => previous.length === ends.length && previous.every((item, index) => item.rel === ends[index].rel && item.right === ends[index].right) ? previous : ends);
      fileTabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(fileTabs.current);
    const list = fileTabs.current.querySelector('[role="tablist"]');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [active, tabSignature, visible, s.codeLayout]);

  const read = React.useCallback((rel: string) => {
    let request = requests.current.get(rel);
    if (!request) {
      request = s.hub.call<FileContent>('readFile', project, rel).finally(() => requests.current.delete(rel));
      requests.current.set(rel, request);
    }
    return request;
  }, [project, s.hub]);
  const openDoc = React.useCallback(async (rel: string, intent: OpenIntent = 'preview', ln?: number) => {
    const id = ++sequence.current;
    setError(null);
    const existing = docsRef.current.find((doc) => doc.rel === rel);
    if (existing) {
      if (intent === 'pinned') setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, pinned: true } : doc));
      setActive(rel); setLine(ln); setBrowse(false); setBusy(false); setOpening(null); return;
    }
    setBusy(true); setOpening(rel);
    try {
      const file = await read(rel);
      if (id !== sequence.current) return;
      const next: Doc = { ...file, rel, text: file.content, dirty: false, pinned: intent === 'pinned', mode: imageMime(rel) || /\.(md|mdx|markdown)$/i.test(rel) ? 'preview' : 'edit' };
      setDocs((all) => openFileTab(all, next, intent));
      setActive(rel); setLine(ln); setBrowse(false);
      setOpen((folders) => { const next = new Set(folders); const parts = rel.split('/'); parts.slice(0, -1).forEach((_, i) => next.add(parts.slice(0, i + 1).join('/'))); return next; });
    } catch { if (id === sequence.current) setError({ rel, intent, line: ln }); }
    finally { if (id === sequence.current) { setBusy(false); setOpening(null); } }
  }, [read]);
  React.useEffect(() => {
    const request = s.fileToOpen;
    if (!visible || !request || request.project !== project || handledIntent.current === request.n) return;
    handledIntent.current = request.n; void openDoc(request.rel, request.intent, request.line);
  }, [s.fileToOpen, visible, project, openDoc]);

  const autoOpened = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = s.thread?.id;
    if (!visible || !s.codeLayout || !id || autoOpened.current === id || !files || busy) return;
    if (s.fileToOpen?.project === project && !active) return;
    autoOpened.current = id;
    if (active) return;
    const recorded = s.thread?.messages.flatMap((message) => message.role === 'assistant' ? message.files.filter((file) => !file.external).map((file) => file.rel) : []).at(-1);
    const entry = recorded && files.includes(recorded) ? recorded : files.find((file) => /^(src\/)?(main|app|index)\.[cm]?[jt]sx?$/i.test(file))
      || files.find((file) => /^readme\.md$/i.test(file))
      || files.find((file) => /\.(tsx?|jsx?|py|rs|go|java|html|css)$/i.test(file) && !/(^|\/)(node_modules|dist|build|fixtures|test|tests)\//.test(file));
    if (entry) void openDoc(entry);
  }, [visible, s.codeLayout, s.thread?.id, files, busy, active, project, openDoc, s.fileToOpen]);

  const watched = JSON.stringify([...new Set([...(active ? [active] : []), ...docs.map((doc) => doc.rel)])].slice(0, 24).sort());
  React.useEffect(() => {
    if (!visible) return;
    let disposed = false; let watchId = '';
    const refresh = async (rel: string) => {
      try {
        const next = await read(rel);
        if (disposed) return;
        setDocs((all) => all.map((doc) => doc.rel !== rel ? doc : doc.dirty
          ? { ...doc, diskChanged: next.content !== doc.content || next.mtime !== doc.mtime, diskError: false }
          : { ...doc, ...next, rel, text: next.content, dirty: false, diskChanged: false, diskError: false }));
      } catch { if (!disposed) setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, diskError: true } : doc)); }
    };
    // Also catch changes made while this project was inactive.
    for (const rel of JSON.parse(watched) as string[]) void refresh(rel);
    const off = s.hub.on('files-changed', (event) => {
      if (disposed || event.project !== project || event.watchId !== watchId) return;
      if (event.error) { setLive('Live updates unavailable'); return; }
      if (event.paths.includes('')) { setDirectoryRevision((value) => value + 1); load(); }
      for (const rel of event.paths.filter(Boolean)) void refresh(rel);
    });
    s.hub.call<string>('watchFiles', project, JSON.parse(watched)).then((id) => {
      if (disposed) s.hub.call('unwatchFiles', id).catch(() => {});
      else { watchId = id; setLive('Live updates'); }
    }).catch(() => { if (!disposed) setLive('Live updates unavailable'); });
    return () => { disposed = true; if (typeof off === 'function') off(); if (watchId) s.hub.call('unwatchFiles', watchId).catch(() => {}); };
  }, [visible, project, watched, s.hub, read, load, watchRevision]);

  const doc = docs.find((doc) => doc.rel === active) ?? null;
  const toggleWrap = () => setDocs((all) => all.map((item) => item.rel === active ? { ...item, wrap: !item.wrap } : item));
  const pin = (rel: string) => setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, pinned: true } : doc));
  const save = async () => {
    if (!doc || doc.binary || doc.truncated) return;
    const text = doc.text;
    try {
      const result = await s.hub.call<{ mtime: number }>('writeFile', project, doc.rel, text, doc.mtime);
      setDocs((all) => all.map((item) => item.rel === doc.rel ? { ...item, mtime: result.mtime, dirty: item.text !== text, content: text, diskChanged: false, diskError: false } : item));
      s.refreshGit(project);
    } catch (e) { toast.error((e as Error).message); }
  };
  const reload = async (rel: string) => {
    try {
      const file = await read(rel);
      setDocs((all) => all.map((item) => item.rel === rel ? { ...item, ...file, text: file.content, dirty: false, diskChanged: false, diskError: false } : item));
    } catch { setError({ rel, intent: 'pinned', reload: true }); }
  };
  const close = (paths: string[], confirmed = false) => {
    if (!confirmed && docsRef.current.some((doc) => paths.includes(doc.rel) && doc.dirty)) {
      restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths }); return;
    }
    ++sequence.current; setBusy(false); setOpening(null);
    const next = closeFileTabs(docsRef.current, activeRef.current, paths);
    setDocs(next.tabs); setActive(next.active);
    // A removed close button cannot receive focus; select its surviving neighbour.
    requestAnimationFrame(focusActiveTab);
  };
  const shown = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? (files ?? []).filter((file) => file.toLowerCase().includes(query) && (hidden || !file.split('/').some((part) => part.startsWith('.')))).slice(0, 2000) : [];
  }, [files, filter, hidden]);
  const tree = React.useMemo(() => buildTree(shown), [shown]);
  React.useEffect(() => { if (filter.trim()) setOpen((folders) => new Set([...folders, ...shown.flatMap((file) => { const parts = file.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); })])); }, [shown, filter]);
  const toggle = (path: string) => setOpen((folders) => { const next = new Set(folders); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const browseFiles = () => { setBrowse(true); setCollapsed(false); setSearchOpen(true); };
  const closeSearch = () => { setSearchOpen(false); setFilter(''); searchToggle.current?.focus(); };
  const refreshFiles = () => { load(); setDirectoryRevision((value) => value + 1); setWatchRevision((value) => value + 1); };
  const label = (rel: string) => fileTabLabel(rel, docs.map((doc) => doc.rel));
  const iconButton = 'workbench-action shrink-0 [&_svg]:size-4';

  const fileNavigation = (<div className="workbench-toolbar workspace-file-navigation border-b bg-background/60 pr-2">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={cn(iconButton, s.codeLayout && !small && !collapsed && 'hidden')} aria-label={small ? 'Browse files' : collapsed ? 'Show explorer' : 'Collapse explorer'} aria-expanded={small ? browse : !collapsed} onClick={() => small ? setBrowse(!browse) : setCollapsed(!collapsed)}>{collapsed || (small && !browse) ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></TooltipTrigger><TooltipContent>{small ? 'Browse files' : collapsed ? 'Show explorer' : 'Collapse explorer'}</TooltipContent></Tooltip>
        <div ref={fileTabs} className="workspace-file-strip @container relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList aria-label="Open files" variant="line" className="workspace-file-list justify-start gap-0 rounded-none p-0">
            {docs.map((item) => <TabsTrigger key={item.rel} value={item.rel} data-file-path={item.rel} title={item.rel} aria-label={`${item.rel}${!item.pinned ? ', preview' : ''}${item.dirty ? ', unsaved' : ''}`} onDoubleClick={() => pin(item.rel)} className={cn('workspace-file-tab h-10 min-w-0 max-w-[min(16rem,100cqw)] flex-none justify-start rounded-none border-0 px-3 pr-10 text-[13px] font-normal after:hidden focus-visible:ring-inset max-sm:h-11 max-sm:pr-12', !item.pinned && 'italic')}>
              <FileTypeIcon path={item.rel} /><span className="truncate">{label(item.rel)}</span>
              {item.dirty && <Circle aria-hidden="true" className="size-2 fill-current" />}
            </TabsTrigger>)}
          </TabsList>
          <div role="group" aria-label="Close files" className="pointer-events-none absolute inset-0">
            {tabEnds.map(({ rel, right }) => <Button key={rel} variant="ghost" size="icon-sm" className={cn(iconButton, 'workspace-file-close pointer-events-auto absolute rounded-md')} style={{ left: right }} aria-label={`Close ${rel}`} onClick={() => close([rel])}><X /></Button>)}
          </div>
        </div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Open files menu" aria-busy={busy}>{busy ? <Spinner /> : <Ellipsis />}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70dvh] max-w-[calc(100vw-16px)] overflow-y-auto max-sm:[&_[role=menuitem]]:min-h-11">
            <DropdownMenuLabel>Open files</DropdownMenuLabel>
            {!docs.length && <DropdownMenuItem disabled>No open files</DropdownMenuItem>}
            {docs.map((item) => <DropdownMenuItem key={item.rel} title={item.rel} aria-label={`${item.rel}${item.dirty ? ', unsaved' : ''}`} onSelect={() => { void openDoc(item.rel); }}><Check className={cn('size-4', active !== item.rel && 'invisible')} /><span className={cn('max-w-64 truncate', !item.pinned && 'italic')}>{label(item.rel)}</span>{item.dirty && <Circle className="size-2 fill-current" />}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc || doc.pinned} onSelect={() => doc && pin(doc.rel)}><Pin />Keep open</DropdownMenuItem>
            {doc?.mode === 'edit' && !doc.binary && <DropdownMenuCheckboxItem checked={!!doc.wrap} onCheckedChange={toggleWrap}>Wrap lines</DropdownMenuCheckboxItem>}
            {doc && IMAGE.test(doc.rel) && editors.map((editor) => <DropdownMenuItem key={editor.id} onSelect={() => s.hub.call('openInEditor', editor.id, project, doc.rel).catch((e) => toast.error(e.message))}><SquareArrowOutUpRight />Open in {editor.name}</DropdownMenuItem>)}
            <DropdownMenuItem disabled={docs.length < 2} onSelect={() => close(docs.filter((item) => item.rel !== active).map((item) => item.rel))}>Close others</DropdownMenuItem>
            <DropdownMenuItem disabled={!docs.some((item) => !item.dirty)} onSelect={() => close(docs.filter((item) => !item.dirty).map((item) => item.rel))}>Close saved tabs</DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onSelect={() => { if (!doc) return; if (doc.dirty) { restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths: [doc.rel], reload: true }); } else void reload(doc.rel); }}><RotateCw />Reload from disk</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>);

  return <div ref={root} className="relative flex h-full min-h-0 flex-col text-[13px]">
    <Tabs value={active ?? ''} onValueChange={(rel) => { ++sequence.current; setBusy(false); setOpening(null); setError(null); setActive(rel); setLine(undefined); setBrowse(false); }} className="min-h-0 flex-1 gap-0">
      {(!s.codeLayout || small) && fileNavigation}
      {busy && <span role="status" className="sr-only">Opening file…</span>}
      {error && <div role="alert" className="absolute inset-x-0 top-10 z-20 flex items-center gap-1 border-b bg-popover px-3 py-1 text-xs max-sm:top-11"><span className="min-w-0 flex-1 truncate" title={error.rel}>Couldn’t read {error.rel.split('/').pop()}.</span><Button variant="ghost" size="sm" onClick={() => { if (error.reload) { setError(null); void reload(error.rel); } else void openDoc(error.rel, error.intent, error.line); }}>Retry</Button><Button variant="ghost" size="icon-sm" aria-label="Dismiss file error" onClick={() => setError(null)}><X /></Button></div>}
      <ResizablePanelGroup id={`files-${project}`} elementRef={fileGroup} className="min-h-0 flex-1" disabled={small || collapsed} onLayoutChanged={(layout, meta) => { if (meta.isUserInteraction && !small && !collapsed && fileGroup.current) explorerWidth.current = Math.min(360, Math.max(176, layout[`explorer-${project}`] * (fileGroup.current.clientWidth - 1) / 100)); }}>
        <ResizablePanel id={`explorer-${project}`} panelRef={explorer} defaultSize={small ? browse ? '100%' : 0 : 200} minSize={small ? browse ? '100%' : 0 : collapsed ? 0 : 176} maxSize={small ? browse ? '100%' : 0 : collapsed ? 0 : 360} groupResizeBehavior="preserve-pixel-size" className="h-full">
          <div className={cn('workspace-explorer flex h-full min-h-0 flex-col bg-background/50', (small ? !browse : collapsed) && 'hidden')}>
            <div role="group" aria-label="File explorer" className="workbench-toolbar gap-0.5 border-b pr-2 pl-3">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={project}>{s.st?.projects.find((entry) => entry.path === project)?.name || project.split('/').pop()}</span>
              <Tooltip><TooltipTrigger asChild><Button ref={searchToggle} variant={searchOpen ? 'secondary' : 'ghost'} size="icon-sm" className={cn(iconButton, 'text-muted-foreground')} aria-label="Find a file" aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><Search /></Button></TooltipTrigger><TooltipContent>Find a file</TooltipContent></Tooltip>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className={cn(iconButton, 'relative text-muted-foreground')} aria-label="Explorer options"><Ellipsis />{hidden && <span className="absolute top-1 right-1 size-1 rounded-full bg-foreground" />}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 max-sm:[&_[role^=menuitem]]:min-h-11">
                  <DropdownMenuCheckboxItem checked={hidden} onCheckedChange={setHidden}>Show hidden files</DropdownMenuCheckboxItem>
                  <DropdownMenuItem onSelect={refreshFiles}><RefreshCw />Refresh files</DropdownMenuItem>
                  {!small && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setCollapsed(true)}><PanelLeftClose />Collapse explorer</DropdownMenuItem></>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {searchOpen && <div id={searchId} className="flex shrink-0 items-center gap-1 border-b p-1.5">
              <Input ref={search} value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); } }} placeholder="Find a file…" aria-label="Find a file" className="h-8 min-w-0 bg-transparent text-[13px] shadow-none max-sm:h-11" />
              <Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Close file search" onClick={closeSearch}><X /></Button>
            </div>}
            <div className="min-h-0 flex-1 overflow-auto px-1 pt-1 pb-2" role="region" aria-label="Project files">
              {!filter.trim() ? <DirectoryTree bridge={s.hub} project={project} active={active} openFile={openDoc} revision={directoryRevision} expanded={open} toggle={toggle} loading={opening} hidden={hidden} />
                : files == null ? <div className="grid place-items-center p-6"><Spinner /></div>
                  : tree.map((node) => <TreeNode key={node.path} n={node} depth={0} open={open} active={active} onOpen={openDoc} toggle={toggle} loading={opening} />)}
              {filter.trim() && files && !shown.length && <p className="p-3 text-xs text-muted-foreground">No matching files.</p>}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize file explorer" className={small || collapsed ? 'hidden' : ''} />
        <ResizablePanel id={`reader-${project}`} minSize={small ? browse ? 0 : '100%' : 144} maxSize={small && browse ? 0 : '100%'} className="h-full min-w-0">
          <div className={cn('flex h-full min-h-0 flex-col', small && browse && 'hidden')}>
            {s.codeLayout && !small && fileNavigation}
            {doc ? <>
              <div className="workspace-file-actions flex h-7 min-w-0 shrink-0 items-center border-b px-3">
                <nav aria-label="File breadcrumbs" title={doc.rel} className="min-w-0 flex-1 overflow-hidden text-xs text-muted-foreground"><ol className="flex min-w-0 items-center gap-1">
                  {(doc.rel.split('/').length > 3 ? ['…', ...doc.rel.split('/').slice(-2)] : doc.rel.split('/')).map((part, index, parts) => <li key={index} className={cn('flex min-w-0 items-center gap-1', index === parts.length - 1 && 'flex-1')} >{index > 0 && <ChevronRight className="size-3 shrink-0" />}<span className="truncate" aria-current={index === parts.length - 1 ? 'page' : undefined}>{part}</span></li>)}
                </ol></nav>
              </div>
              {(doc.diskChanged || doc.diskError) && <div role="status" className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted px-3 py-1 text-xs"><span className="flex-1">{doc.diskError ? 'File unavailable. Draft kept.' : 'Changed on disk. Draft kept.'}</span><Button variant="ghost" size="sm" onClick={() => { if (doc.dirty) { restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths: [doc.rel], reload: true }); } else void reload(doc.rel); }}>Reload</Button></div>}
              <div className="min-h-0 flex-1">
                {docs.map((item) => <TabsContent key={item.rel} value={item.rel} tabIndex={-1} className="h-full min-h-0">
                  {item.rel === active && (item.binary && !IMAGE.test(item.rel) ? <p className="p-6 text-center text-sm text-muted-foreground">Binary file · {item.size.toLocaleString()} bytes</p>
                    : item.mode === 'preview' && previewable(item.rel) ? <FilePreview doc={item} project={project} />
                      : <CodeEditor project={project} path={item.rel} value={item.text} line={line} readOnly={item.truncated} wrap={item.wrap} onToggleWrap={toggleWrap} onCursorChange={(position) => setCursors((all) => all[item.rel]?.line === position.line && all[item.rel]?.column === position.column ? all : { ...all, [item.rel]: position })} onSave={save} onChange={(value) => setDocs((all) => all.map((current) => current.rel === item.rel ? { ...current, text: value, dirty: value !== current.content, pinned: true } : current))} />)}
                </TabsContent>)}
              </div>
              {!IMAGE.test(doc.rel) && <div className="workspace-file-footer flex min-w-0 shrink-0 items-center gap-1 border-t pr-2 pl-3">
                <p role="status" aria-live="off" className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground" title={doc.mode === 'edit' && !doc.binary ? `${doc.rel.split('.').pop()?.toUpperCase() || 'Text'} · ${doc.text.includes('\r\n') ? 'CRLF' : 'LF'} · ${live}` : live}>{doc.mode === 'edit' && !doc.binary ? <><span aria-label="Editor position">Ln {cursors[doc.rel]?.line ?? 1}, Col {cursors[doc.rel]?.column ?? 1}</span><span className="editor-file-details"> · {doc.rel.split('.').pop()?.toUpperCase() || 'Text'} · {doc.text.includes('\r\n') ? 'CRLF' : 'LF'}</span>{doc.truncated && ' · Read only'}</> : live}</p>
                <div role="group" aria-label="File actions" className="flex shrink-0 items-center gap-0.5">
                {doc.mode === 'edit' && !doc.binary && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-wrap-control')} aria-label="Wrap lines" aria-pressed={!!doc.wrap} onClick={toggleWrap}><WrapText /></Button></TooltipTrigger><TooltipContent>Wrap lines (Alt+Z)</TooltipContent></Tooltip>}
                {previewable(doc.rel) && !doc.binary && !IMAGE.test(doc.rel) && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} aria-label={doc.mode === 'edit' ? 'Preview file' : 'Edit file'} onClick={() => setDocs((all) => all.map((item) => item.rel === doc.rel ? { ...item, mode: item.mode === 'edit' ? 'preview' : 'edit' } : item))}>{doc.mode === 'edit' ? <Eye /> : <Pencil />}</Button></TooltipTrigger><TooltipContent>{doc.mode === 'edit' ? 'Preview' : 'Edit'}</TooltipContent></Tooltip>}
                {editors.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} aria-label="Open in editor" title="Open in editor"><SquareArrowOutUpRight /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-sm:[&_[role=menuitem]]:min-h-11"><DropdownMenuLabel>Open in editor</DropdownMenuLabel>{editors.map((editor) => <DropdownMenuItem key={editor.id} onClick={() => s.hub.call('openInEditor', editor.id, project, doc.rel, line).catch((e) => toast.error(e.message))}>{editor.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
                {!doc.binary && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} disabled={!doc.dirty || doc.truncated} aria-label="Save file" onClick={save}><Save /></Button></TooltipTrigger><TooltipContent>Save</TooltipContent></Tooltip>}
                </div>
              </div>}
            </> : <Empty className="h-full border-0 p-4"><EmptyHeader><EmptyMedia variant="icon"><ImageIcon /></EmptyMedia><EmptyTitle>Select a file</EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" size="sm" onClick={browseFiles}><FolderOpen />Browse files</Button></EmptyContent></Empty>}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Tabs>
    <AlertDialog open={!!confirmation} onOpenChange={(isOpen) => { if (!isOpen) setConfirmation(null); }}>
      <AlertDialogContent className="max-w-[calc(100vw-32px)] max-sm:[&_button]:min-h-11" onCloseAutoFocus={(event) => {
        event.preventDefault();
        const target = restoreFocus.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else focusActiveTab();
      }}>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription className="break-words">{confirmation?.paths.filter((path) => docs.find((doc) => doc.rel === path)?.dirty).join(', ')}<br />Your edits will be lost.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!confirmation) return; if (confirmation.reload) void reload(confirmation.paths[0]); else close(confirmation.paths, true); setConfirmation(null); }}>Discard changes</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
