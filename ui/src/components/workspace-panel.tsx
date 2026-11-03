import * as React from 'react';
import { toast } from 'sonner';
import {
  BookOpen, ChevronRight, Circle, Code2, Eye, File, FileCode2, Folder, FolderOpen, GitCompareArrows, Globe, History, Image as ImageIcon,
  Pencil, RefreshCw, RotateCw, Save, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { CodeEditor } from '@/components/code-editor';
import { DirectoryTree } from '@/components/directory-tree';
import { HighlightedCode, Markdown } from '@/components/markdown';
import { ReviewTab } from '@/components/review-panel';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore, type PanelTab } from '@/store';
import type { FileContent, MemoryInfo, ThreadChange } from '@/types';

const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'review', label: 'Review', icon: <GitCompareArrows /> },
  { id: 'changes', label: 'Changes', icon: <History /> },
  { id: 'files', label: 'Files', icon: <Code2 /> },
  { id: 'memory', label: 'Memory', icon: <BookOpen /> },
  { id: 'preview', label: 'Preview', icon: <Globe /> },
];

// ---------- Changes: every file the thread touched, and what each turn did to it
function ChangesTab() {
  const s = useStore();
  const [list, setList] = React.useState<ThreadChange[] | null>(null);
  const [sel, setSel] = React.useState<{ rel: string; messageId: string } | null>(null);
  const [diff, setDiff] = React.useState<string | null>(null);
  const tid = s.thread?.id; const count = s.thread?.messages.length ?? 0;
  React.useEffect(() => { if (tid) s.hub.call<ThreadChange[]>('threadChanges', tid).then(setList).catch(() => setList([])); else setList([]); }, [tid, count, s.hub]);
  React.useEffect(() => {
    if (!sel || !tid) return; setDiff(null);
    s.hub.call<string>('turnDiff', tid, sel.messageId, sel.rel).then(setDiff).catch((e) => setDiff(`Could not load this change: ${e.message}`));
  }, [sel, tid, s.hub]);
  if (!tid) return <p className="p-6 text-center text-sm text-muted-foreground">Start a thread to see every file the agents change.</p>;
  if (!list) return <div className="grid place-items-center p-8"><Spinner /></div>;
  if (!list.length) return <p className="p-6 text-center text-sm text-muted-foreground">No agent has changed a file in this thread yet.</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="max-h-[45%] shrink-0 overflow-auto border-b py-1">
        {list.map((f) => (
          <li key={f.rel} className="px-3 py-1.5">
            <div className="flex items-center gap-2"><File className="size-3.5 text-muted-foreground" /><span className="truncate font-mono text-[12.5px]">{f.rel}</span></div>
            <div className="mt-1 flex flex-wrap gap-1 pl-5">
              {f.turns.map((t, i) => (
                <button key={`${t.messageId}-${i}`} onClick={() => setSel({ rel: f.rel, messageId: t.messageId })}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11.5px] hover:bg-muted', sel?.messageId === t.messageId && sel.rel === f.rel && 'border-brand bg-brand/10')}>
                  <AgentAvatar agent={s.agentOf(t.agent)} size="xs" />{s.agentOf(t.agent).name}{t.team ? ` as ${t.team}` : ''}{t.ts ? <span className="text-muted-foreground">{ago(t.ts)}</span> : null}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!sel ? <p className="pt-6 text-center text-sm text-muted-foreground">Pick a turn to see exactly what that agent changed.</p>
          : diff == null ? <div className="grid place-items-center p-8"><Spinner /></div>
            : diff ? <HighlightedCode code={diff} language="diff" title={<span className="font-mono text-xs">{sel.rel}</span>} /> : <p className="text-sm text-muted-foreground">This turn made no net change to the file.</p>}
      </div>
    </div>
  );
}

// ---------- Files: tree + tabs + real editor + previews
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
function TreeNode({ n, depth, open, toggle, active, onOpen }: { n: Node; depth: number; open: Set<string>; toggle: (p: string) => void; active: string | null; onOpen: (p: string) => void }) {
  const isOpen = open.has(n.path);
  return (
    <>
      <button onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))} title={n.path}
        className={cn('flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[13px] hover:bg-muted/70', active === n.path && 'bg-accent text-accent-foreground')} style={{ paddingLeft: 6 + depth * 12 }}>
        {n.dir ? <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} /> : <span className="w-3.5 shrink-0" />}
        {n.dir ? (isOpen ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />) : <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate">{n.name}</span>
      </button>
      {n.dir && isOpen && n.children.map((c) => <TreeNode key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} active={active} onOpen={onOpen} />)}
    </>
  );
}
type Doc = FileContent & { text: string; dirty: boolean };
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
function FilePreview({ doc }: { doc: Doc }) {
  const html = React.useMemo(() => (/\.html?$/i.test(doc.rel) ? URL.createObjectURL(new Blob([doc.text], { type: 'text/html' })) : null), [doc.rel, doc.text]);
  React.useEffect(() => () => { if (html) URL.revokeObjectURL(html); }, [html]);
  if (IMAGE.test(doc.rel) && doc.base64) return <div className="grid h-full place-items-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4"><img alt={doc.rel} className="max-h-full max-w-full" src={`data:image/${doc.rel.split('.').pop()};base64,${doc.base64}`} /></div>;
  if (/\.svg$/i.test(doc.rel)) return <div className="grid h-full place-items-center overflow-auto p-4"><img alt={doc.rel} className="max-h-full max-w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc.text)}`} /></div>;
  if (/\.(md|mdx|markdown)$/i.test(doc.rel)) return <div className="h-full overflow-auto px-5 py-4"><Markdown text={doc.text} /></div>;
  if (html) return <iframe title={`Preview of ${doc.rel}`} sandbox="" src={html} className="h-full w-full bg-white" />;
  return null;
}
const previewable = (rel: string) => IMAGE.test(rel) || /\.(svg|md|mdx|markdown|html?)$/i.test(rel);

function FilesTab() {
  const s = useStore();
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [directoryRevision, setDirectoryRevision] = React.useState(0);
  const [filter, setFilter] = React.useState('');
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit');
  const [line, setLine] = React.useState<number | undefined>();
  const [editors, setEditors] = React.useState<{ id: string; name: string }[]>([]);
  const project = s.workdir; // the conversation's separate copy, when it has one
  const load = React.useCallback(() => { if (project) s.hub.call<string[]>('listFiles', project).then(setFiles).catch(() => setFiles([])); }, [project, s.hub]);
  React.useEffect(() => { setDocs([]); setActive(null); load(); }, [project, load]);
  React.useEffect(() => { if (s.hub.platform === 'desktop') s.hub.call<{ id: string; name: string }[]>('editors').then(setEditors).catch(() => {}); }, [s.hub]);
  const openDoc = React.useCallback(async (rel: string, ln?: number) => {
    if (!project) return;
    setActive(rel); setLine(ln);
    const parts = rel.split('/'); setOpen((o) => { const n = new Set(o); parts.slice(0, -1).forEach((_, i) => n.add(parts.slice(0, i + 1).join('/'))); return n; });
    if (docs.find((d) => d.rel === rel)) return;
    try {
      const f = await s.hub.call<FileContent>('readFile', project, rel);
      setDocs((d) => [...d.filter((x) => x.rel !== rel), { ...f, rel, text: f.content, dirty: false }]);
      setMode(previewable(rel) && (IMAGE.test(rel) || /\.(md|mdx|markdown)$/i.test(rel)) ? 'preview' : 'edit');
    } catch (e) { toast.error((e as Error).message); }
  }, [project, docs, s.hub]);
  // Requests from elsewhere (file chips, review) to open a file.
  React.useEffect(() => { if (s.fileToOpen) openDoc(s.fileToOpen.rel, s.fileToOpen.line); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [s.fileToOpen]);
  const doc = docs.find((d) => d.rel === active) || null;
  const save = async () => {
    if (!doc || !project) return;
    try {
      const r = await s.hub.call<{ mtime: number }>('writeFile', project, doc.rel, doc.text, doc.mtime);
      setDocs((d) => d.map((x) => (x.rel === doc.rel ? { ...x, mtime: r.mtime, dirty: false, content: x.text } : x)));
      toast.success(`Saved ${doc.rel}`); s.refreshGit();
    } catch (e) { toast.error((e as Error).message); }
  };
  const reload = async () => {
    if (!doc || !project) return;
    if (doc.dirty && !window.confirm(`Discard your unsaved changes to ${doc.rel}?`)) return;
    const f = await s.hub.call<FileContent>('readFile', project, doc.rel);
    setDocs((d) => d.map((x) => (x.rel === doc.rel ? { ...f, rel: doc.rel, text: f.content, dirty: false } : x)));
  };
  const close = (rel: string) => {
    const d = docs.find((x) => x.rel === rel);
    if (d?.dirty && !window.confirm(`Close ${rel} without saving?`)) return;
    const rest = docs.filter((x) => x.rel !== rel); setDocs(rest);
    if (active === rel) setActive(rest[rest.length - 1]?.rel ?? null);
  };
  const shown = React.useMemo(() => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.toLowerCase().includes(q)).slice(0, 2000) : files;
  }, [files, filter]);
  const tree = React.useMemo(() => buildTree(shown), [shown]);
  React.useEffect(() => { if (filter.trim()) setOpen(new Set(shown.flatMap((f) => { const p = f.split('/'); return p.slice(0, -1).map((_, i) => p.slice(0, i + 1).join('/')); }))); }, [filter, shown]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r">
        <div className="flex items-center gap-1 p-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a file…" aria-label="Find a file" className="h-7 text-xs" />
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => { load(); setDirectoryRevision((v) => v + 1); }} aria-label="Refresh files"><RefreshCw /></Button></TooltipTrigger><TooltipContent>Refresh</TooltipContent></Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1 pb-2" aria-label="Project files">
          {!filter.trim() && project ? <DirectoryTree bridge={s.hub} project={project} active={active} openFile={(p) => openDoc(p)} revision={directoryRevision} /> : files == null ? <div className="grid place-items-center p-6"><Spinner /></div>
            : tree.map((n) => <TreeNode key={n.path} n={n} depth={0} open={open} active={active} onOpen={(p) => openDoc(p)} toggle={(p) => setOpen((o) => { const x = new Set(o); if (x.has(p)) x.delete(p); else x.add(p); return x; })} />)}
          {filter.trim() && <p className="px-3 pt-2 text-[11px] text-muted-foreground">Search uses the project index; ignored and hidden files may be excluded. Clear the search to browse folders.</p>}
          {filter.trim() && files && !shown.length && <p className="p-3 text-xs text-muted-foreground">No indexed files match.</p>}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {docs.length > 0 && (
          <div className="flex shrink-0 items-center border-b">
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {docs.map((d) => (
                <div key={d.rel} className={cn('group flex shrink-0 items-center gap-1 border-r py-1.5 pr-1 pl-2.5 text-[12.5px]', d.rel === active ? 'bg-card text-foreground' : 'bg-muted/40 text-muted-foreground')}>
                  <button onClick={() => setActive(d.rel)} className="max-w-40 truncate" title={d.rel}>{d.rel.split('/').pop()}</button>
                  <button onClick={() => close(d.rel)} aria-label={`Close ${d.rel}`} className="grid size-4 place-items-center rounded hover:bg-muted">
                    {d.dirty ? <Circle className="size-2 fill-current group-hover:hidden" /> : null}<X className={cn('size-3', d.dirty && 'hidden group-hover:block')} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {doc ? (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{doc.rel}{doc.truncated ? ' (first 1 MB, read-only)' : ''}</span>
              {previewable(doc.rel) && !doc.binary && !IMAGE.test(doc.rel) && (
                <Button size="xs" variant="ghost" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>{mode === 'edit' ? <><Eye /> Preview</> : <><Pencil /> Edit</>}</Button>
              )}
              <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" onClick={reload} aria-label="Reload from disk"><RotateCw /></Button></TooltipTrigger><TooltipContent>Reload from disk</TooltipContent></Tooltip>
              {editors.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="xs" variant="ghost">Open in…</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end"><DropdownMenuLabel>Open this file in</DropdownMenuLabel>
                    {editors.map((e) => <DropdownMenuItem key={e.id} onClick={() => s.hub.call('openInEditor', e.id, project, doc.rel, line)}>{e.name}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button size="xs" disabled={!doc.dirty || doc.truncated || doc.binary} onClick={save}><Save /> Save</Button>
            </div>
            <div className="min-h-0 flex-1">
              {doc.binary && !IMAGE.test(doc.rel) ? <p className="p-6 text-center text-sm text-muted-foreground">This is a binary file, so it can’t be shown here.</p>
                : mode === 'preview' && previewable(doc.rel) ? <FilePreview doc={doc} />
                  : <CodeEditor path={doc.rel} value={doc.text} line={line} readOnly={doc.truncated} onSave={save}
                    onChange={(v) => setDocs((d) => d.map((x) => (x.rel === doc.rel ? { ...x, text: v, dirty: v !== x.content } : x)))} />}
            </div>
          </>
        ) : (
          <Empty className="h-full border-0"><EmptyHeader><EmptyMedia variant="icon"><ImageIcon /></EmptyMedia><EmptyTitle>Open a file</EmptyTitle>
            <EmptyDescription>Pick a file on the left to read or edit it. Markdown, images and HTML get a live preview. Ctrl+S saves.</EmptyDescription></EmptyHeader></Empty>
        )}
      </div>
    </div>
  );
}

// ---------- Memory: shared facts and the work log every agent reads
function MemoryTab() {
  const s = useStore(); const [m, setM] = React.useState<MemoryInfo | null>(null); const [text, setText] = React.useState('');
  const load = React.useCallback(() => { if (s.project) s.hub.call<MemoryInfo>('memory', s.project).then((x) => { setM(x); setText(x.memory ?? ''); }).catch(() => setM({ enabled: false, memory: null, worklog: [] })); }, [s.project, s.hub]);
  React.useEffect(load, [load, s.thread?.messages.length]);
  if (!m) return <div className="grid place-items-center p-8"><Spinner /></div>;
  if (!m.enabled) return (
    <Empty className="h-full border-0"><EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>Give every agent the same memory</EmptyTitle>
      <EmptyDescription>Tributary keeps project facts in .tributary/memory.md and a log of what each agent did in .tributary/worklog.md. AGENTS.md tells every agent to read them, so nobody starts from zero.</EmptyDescription></EmptyHeader>
      <EmptyContent><Button onClick={async () => { await s.hub.call('enableMemory', s.project); toast.success('Shared memory is on for this project'); load(); s.refreshGit(); }}>Turn on shared memory</Button></EmptyContent></Empty>
  );
  const dirty = text !== (m.memory ?? '');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="flex-1 text-sm font-medium">Project memory</span>
        <Button size="xs" variant="ghost" onClick={load}><RefreshCw /> Reload</Button>
        <Button size="xs" disabled={!dirty} onClick={async () => { await s.hub.call('saveMemory', s.project, text); toast.success('Memory saved'); load(); }}><Save /> Save</Button>
      </div>
      <div className="min-h-0 flex-[3] border-b"><CodeEditor path="memory.md" value={text} onChange={setText} onSave={async () => { await s.hub.call('saveMemory', s.project, text); toast.success('Memory saved'); load(); }} /></div>
      <div className="flex min-h-0 flex-[2] flex-col">
        <div className="shrink-0 px-3 py-1.5 text-sm font-medium">Work log</div>
        <ul className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-[12.5px]">
          {[...m.worklog].reverse().map((l, i) => <li key={i} className="border-b border-border/60 py-1 text-muted-foreground">{l.replace(/^- /, '')}</li>)}
          {!m.worklog.length && <li className="text-muted-foreground">Each agent turn adds a line here.</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------- Preview: the app you are building, served locally
function PreviewTab() {
  const s = useStore();
  const [url, setUrl] = React.useState(() => { try { return localStorage.getItem('tributary.previewUrl') || 'http://localhost:3000'; } catch { return 'http://localhost:3000'; } });
  const [shown, setShown] = React.useState(url); const [n, setN] = React.useState(0);
  const go = () => { const u = /^https?:\/\//.test(url) ? url : `http://${url}`; setShown(u); setN((x) => x + 1); try { localStorage.setItem('tributary.previewUrl', u); } catch { /* ignore */ } };
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(shown);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex shrink-0 items-center gap-1 border-b p-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Preview address" className="h-7 font-mono text-xs" placeholder="http://localhost:3000" />
        <Button size="icon-xs" variant="ghost" type="submit" aria-label="Reload preview"><RotateCw /></Button>
        <Button size="xs" variant="ghost" type="button" onClick={() => s.hub.call('openExternal', shown)}>Open in browser</Button>
      </form>
      {local && s.hub.platform !== 'vscode'
        ? <iframe key={n} title="App preview" src={shown} className="min-h-0 flex-1 bg-white" />
        : <p className="p-6 text-center text-sm text-muted-foreground">{local ? 'Use “Open in browser” to view it from VS Code.' : 'Only local addresses (localhost or 127.0.0.1) can be previewed here. Start your dev server, for example with npm run dev in the terminal.'}</p>}
    </div>
  );
}

export function WorkspacePanel() {
  const s = useStore();
  const [width, setWidth] = React.useState(() => { try { return Number(localStorage.getItem('tributary.panelWidth')) || 520; } catch { return 520; } });
  const drag = (e: React.PointerEvent) => {
    const startX = e.clientX; const start = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(Math.max(360, start + (startX - ev.clientX)), Math.round(window.innerWidth * 0.7)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('tributary.panelWidth', String(width)); } catch { /* ignore */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const changed = s.git?.changed.length ?? 0;
  return (
    <aside aria-label="Workspace" className="relative flex h-full shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-0 max-md:z-40 max-md:!w-full" style={{ width }}>
      <div role="separator" aria-orientation="vertical" aria-label="Resize workspace" onPointerDown={drag} className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand/30 max-md:hidden" />
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Tabs value={s.panel.tab} onValueChange={(v) => s.setPanel({ open: true, tab: v as PanelTab })} className="min-w-0 flex-1">
          <TabsList className="h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="gap-1.5 px-2 text-[12.5px] [&_svg]:size-3.5">
                {t.icon}<span className="max-lg:hidden">{t.label}</span>{t.id === 'review' && changed > 0 && <span className="rounded-full bg-muted px-1 text-[10.5px] tabular-nums">{changed}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => s.setPanel({ ...s.panel, open: false })} aria-label="Close workspace"><X /></Button></TooltipTrigger><TooltipContent>Close (Esc)</TooltipContent></Tooltip>
      </header>
      <div className="min-h-0 flex-1">
        {s.panel.tab === 'review' && <ReviewTab />}
        {s.panel.tab === 'changes' && <ChangesTab />}
        {s.panel.tab === 'files' && <FilesTab />}
        {s.panel.tab === 'memory' && <MemoryTab />}
        {s.panel.tab === 'preview' && <PreviewTab />}
      </div>
    </aside>
  );
}
