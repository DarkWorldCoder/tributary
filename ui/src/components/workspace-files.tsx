import { fileSearch, type FileSearchResult } from '@/lib/file-search.mjs';
import type { EditorCommand } from '@/components/agent-workbench';
import { editorGroups, selectGroupFile, focusEditorGroupAt, splitEditorGroup, moveGroupFile, closeGroupFiles, joinEditorGroup, restoreEditorGroups, type EditorGroup, type EditorGroups } from '@/lib/editor-groups.mjs';
import { createDirectorySession, type DirectorySession } from '@/lib/directory-session.mjs';
import { useTreeViewport } from '@/hooks/use-tree-viewport';
import { ProjectSearch } from '@/components/project-search';
import { WorkspaceFolderRow } from '@/components/workspace-folder-row';
import { useWorkspaceGit, WorkspaceFileChange } from '@/components/workspace-changes';
import { workspaceChanges } from '@/lib/workspace-changes.mjs';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FormatProjectDialog } from '@/components/format-project-dialog';
import { ExplorerOutline } from '@/components/explorer-outline';
import { explorerDecorations } from '@/lib/explorer-decorations.mjs';
import { configuredLanguage } from '@/lib/language-tools';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LineChangeCount } from '@/components/line-change-count';
import { sourceLanguage } from '@/lib/source-language.mjs';
import { editorText } from '@/lib/editor-text.mjs';
import { editorSpacing } from '@/lib/editor-spacing.mjs';
import { DebugSidebar, DebugControls } from '@/components/debug-sidebar';
import { ShortcutLabel, ShortcutKeys } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import { DocumentOutline } from '@/components/document-outline';
import * as React from 'react';
import { toast } from 'sonner';
import { Columns2, Rows2, FilePlus, FolderPlus, GitCompareArrows, Bug, Copy, CircleAlert, SquareTerminal, WandSparkles, Check, ChevronRight, Circle, Ellipsis, Eye, FolderOpen, Image as ImageIcon, PanelLeftClose, PanelLeftOpen, Pencil, Pin, RefreshCw, RotateCw, Save, Search, Undo2, Redo2, SquareArrowOutUpRight, WrapText, X } from 'lucide-react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeferredCodeEditor as CodeEditor, type EditorHistory, type EditorTransfer } from '@/components/deferred-code-editor';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FolderTypeIcon } from '@/components/folder-type-icon';
import { DirectoryTree } from '@/components/directory-tree';
import { Markdown } from '@/components/markdown';
import { ProjectMenu } from '@/components/project-menu';
import { ImagePreview } from '@/components/image-preview';
import { ProjectChecks } from '@/components/project-checks';
import { FileSwitcher } from '@/components/file-switcher';
import { FileDiff } from '@/components/file-diff';
import { draftWriter, fileSession, savedFileSession } from '@/lib/drafts.mjs';
import { createExplorerIndex, type ExplorerNode as Node } from '@/lib/explorer-index.mjs';
import { imageMime, imageSource } from '@/lib/image-preview.mjs';
import { projectProfile } from '@/lib/project-profile.mjs';
import { rememberFile } from '@/lib/recent-work.mjs';
import { fileTabLabel, openFileTab } from '@/lib/workspace-tabs.mjs';
import { cn } from '@/lib/utils';
import { formatParser, nativeFormatTool, formattingHint } from '@/lib/format-document.mjs';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { useStore } from '@/store';
import type { FileContent, ProjectCheckResult } from '@/types';

function TreeNode({ n, depth, open, toggle, active, onOpen, loading, decorations }: { decorations?: ReturnType<typeof explorerDecorations>; n: Node; depth: number; open: Set<string>; toggle: (p: string) => void; active: string | null; onOpen: (p: string, intent?: OpenIntent) => void; loading?: string | null }) {
  const isOpen = open.has(n.path);
  return (
    <>
      <button onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))} aria-expanded={n.dir ? isOpen : undefined} aria-current={!n.dir && active === n.path ? 'page' : undefined} aria-busy={!n.dir && loading === n.path} onDoubleClick={() => { if (!n.dir) onOpen(n.path, 'pinned'); }} title={n.path}
        className={cn('explorer-row flex w-full items-center gap-1.5 rounded-md h-8 min-h-8 max-sm:h-11 max-sm:min-h-11 pr-2 text-left text-[13px] hover:bg-muted/70', active === n.path && 'bg-accent text-accent-foreground')} style={{ paddingLeft: 6 + depth * 12 }}>
        {n.dir ? <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} /> : <span className="w-4 shrink-0" />}
        {n.dir ? <FolderTypeIcon path={n.path} open={isOpen} /> : <FileTypeIcon path={n.path}  />}
        <span className="min-w-0 flex-1 truncate">{n.name}</span>{n.dir ? decorations?.folders.has(n.path) && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Contains changed files" /> : <>{decorations?.files.get(n.path)?.dirty && <span aria-label="Unsaved" className="size-1.5 shrink-0 rounded-full bg-foreground" />}{decorations?.files.get(n.path)?.code && <span aria-label={decorations.files.get(n.path)?.label} className={cn('shrink-0 font-mono text-[11px]', decorations.files.get(n.path)?.code === 'A' ? 'text-success' : decorations.files.get(n.path)?.code === 'D' ? 'text-destructive' : 'text-warning')}>{decorations.files.get(n.path)?.code}</span>}</>}
      </button>
      {n.dir && isOpen && n.children.map((c) => <TreeNode key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} active={active} onOpen={onOpen} loading={loading} decorations={decorations} />)}
    </>
  );
}
type OpenIntent = 'preview' | 'pinned';
// recovered: unsaved text brought back from an earlier session (lib/drafts.mjs).
type Doc = FileContent & { text: string; dirty: boolean; pinned: boolean; mode: 'edit' | 'preview'; diskChanged?: boolean; diskError?: boolean; wrap?: boolean; recovered?: boolean };
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

const EMPTY_BRANCHES = new Set<string>();
const EMPTY_CHAINS = new Map<string, string[]>();
const DebugConsole = React.lazy(() => import('@/components/debug-panel').then((module) => ({ default: module.DebugPanel })));

// This component is kept mounted separately for every visited project in this session.
export function FilesTab({ project, visible }: { project: string; visible: boolean }) {
  const s = useStore();
  const currentOwner = s.st?.projects.find((item) => item.path === project) || (project === s.workdir ? s.st?.projects.find((item) => item.path === s.project) : undefined);
  const lastOwner = React.useRef(currentOwner); if (currentOwner) lastOwner.current = currentOwner;
  const owner = currentOwner || lastOwner.current;
  const roots = [project, ...(owner?.folders || [])].filter((root, index, all) => all.indexOf(root) === index);
  const [expandedRoots, setExpandedRoots] = React.useState(new Set([project]));
  const [rootFolders, setRootFolders] = React.useState<Record<string, Set<string>>>({});
  const toggleRoot = (folder: string) => setExpandedRoots((all) => { const next = new Set(all); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; });
  const toggleBranch = (folder: string, rel: string) => setRootFolders((all) => { const next = new Set(all[folder]); if (next.has(rel)) next.delete(rel); else next.add(rel); return { ...all, [folder]: next }; });
  const [root, setRoot] = React.useState(project); const [kept, setKept] = React.useState([project]);
  const [removedFolder, setRemovedFolder] = React.useState<{ folder: string; restore: () => Promise<void> } | null>(null);
  const [undoingRemoval, setUndoingRemoval] = React.useState(false);
  const folderRemoved = (folder: string, restore: () => Promise<void>) => setRemovedFolder({ folder, restore });
  const folderSelectId = React.useId();
  const selected = roots.includes(root) ? root : project;
  const choose = (next: string) => { setRoot(next); setKept((all) => all.includes(next) ? all : [...all, next]); };
  React.useEffect(() => { const target = s.fileToOpen?.project; if (target && roots.includes(target)) choose(target); }, [s.fileToOpen]);
  React.useEffect(() => {
    if (!visible || selected === project) return;
    const selectAgentRoot = (event: Event) => { const request = (event as CustomEvent<EditorCommand>).detail; if (!request.claimed && request.project === project && request.valid()) choose(project); };
    window.addEventListener('tributary:agent-editor', selectAgentRoot); return () => window.removeEventListener('tributary:agent-editor', selectAgentRoot);
  }, [visible, selected, project]);
  return <div className="flex h-full min-h-0 flex-col">
    {removedFolder && <div role="status" aria-label="Folder removed" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate" title={removedFolder.folder}>{removedFolder.folder.split(/[\\/]/).at(-1)} removed. Files and drafts kept.</span><Button size="xs" variant="outline" disabled={undoingRemoval} onClick={async () => { setUndoingRemoval(true); try { await removedFolder.restore(); setRemovedFolder(null); } catch (e) { toast.error((e as Error).message); } finally { setUndoingRemoval(false); } }}>Undo</Button><Button size="icon-xs" variant="ghost" aria-label="Dismiss folder removal" disabled={undoingRemoval} onClick={() => setRemovedFolder(null)}><X /></Button></div>}
    {roots.length > 1 && <div className="flex min-h-8 shrink-0 items-center gap-2 border-b px-2 py-1"><label className="shrink-0 text-xs text-muted-foreground" htmlFor={folderSelectId}>Folder</label><NativeSelect id={folderSelectId} aria-label="Workspace folder" value={selected} className="min-w-0 flex-1" onChange={(event) => choose(event.target.value)}>{roots.map((folder) => <NativeSelectOption key={folder} value={folder}>{folder.split(/[\\/]/).filter(Boolean).at(-1)}{folder === project ? ' (main)' : ''}</NativeSelectOption>)}</NativeSelect><ProjectMenu projectPath={owner?.path || project}><Button size="xs" variant="ghost">Folders</Button></ProjectMenu></div>}
    <div className="min-h-0 flex-1">{kept.map((folder) => <div key={folder} data-workspace-root={folder} className={folder === selected ? 'h-full min-h-0' : 'hidden'}><FolderFiles project={folder} warm={folder === selected && s.workdir === project} visible={visible && folder === selected} owner={owner?.path || project} roots={roots} expandedRoots={expandedRoots} toggleRoot={toggleRoot} rootFolders={rootFolders} toggleBranch={toggleBranch} onFolderRemoved={folderRemoved} /></div>)}</div>
  </div>;
}

function FolderFiles({ project, visible, warm, owner, roots, expandedRoots, toggleRoot, rootFolders, toggleBranch, onFolderRemoved }: { onFolderRemoved: (folder: string, restore: () => Promise<void>) => void; project: string; visible: boolean; warm: boolean; owner: string; roots: string[]; expandedRoots: Set<string>; toggleRoot: (root: string) => void; rootFolders: Record<string, Set<string>>; toggleBranch: (root: string, rel: string) => void }) {
  const { platform } = useShortcutPreferences();
  const s = useStore();
  const debugVisible = s.debugOpen && visible && project === s.workdir;
  const runInTerminal = useRunInTerminal();
  const [index] = React.useState(createExplorerIndex);
  const [indexVersion, bumpIndex] = React.useReducer((version: number) => version + 1, 0);
  const indexWarm = React.useRef(warm); indexWarm.current = warm;
  const [directoryRevision, setDirectoryRevision] = React.useState(0);
  const [live, setLive] = React.useState('Connecting…');
  const [watchRevision, setWatchRevision] = React.useState(0);
  const [filter, setFilter] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [fileSearchStatus, setFileSearchStatus] = React.useState<{ result?: FileSearchResult; error?: string } | null>(null);
  const [hidden, setHiddenState] = React.useState(() => { try { return localStorage.getItem('tributary.showHiddenFiles') !== 'false'; } catch { return true; } });
  const setHidden = (value: boolean) => { setHiddenState(value); try { localStorage.setItem('tributary.showHiddenFiles', String(value)); } catch {} };
  const [creation, setCreation] = React.useState<{ project: string; kind: 'file' | 'folder'; name: string } | null>(null);
  const [creationBusy, setCreationBusy] = React.useState(false);
  const [creationError, setCreationError] = React.useState('');
  const [checksOpen, setChecksOpen] = React.useState(false);
  const [formatAllOpen, setFormatAllOpen] = React.useState(false);
  const [comparisonRel, setComparison] = React.useState<string | null>(null);
  const repository = useWorkspaceGit(s.hub, project, visible, directoryRevision);
  const changedFiles = React.useMemo(() => workspaceChanges(project, repository.git), [project, repository.git]);
  const reviewSaved = (rel: string) => { s.pauseFollowing(); setComparison(rel); setBrowse(false); };
  const [checkResult, setCheckResult] = React.useState<ProjectCheckResult | null>(null);
  const [liveDiagnostics, setLiveDiagnostics] = React.useState<import('@/types').ProjectDiagnostic[]>([]);
  const updateLiveDiagnostics = React.useCallback((items: import('@/types').ProjectDiagnostic[]) => setLiveDiagnostics((previous) => JSON.stringify(previous) === JSON.stringify(items) ? previous : items), []);
  React.useEffect(() => { if (s.checksIntent?.project === project) setChecksOpen(true); }, [s.checksIntent, project]);
  const searchId = React.useId();
  const [browse, setBrowse] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [groupStats, setGroupStats] = React.useState<Record<string, { rel: string; added?: number; removed?: number; binary?: boolean } | null>>({});
  const [groupHistories, setGroupHistories] = React.useState<Record<string, EditorHistory | null>>({});
  const historiesRef = React.useRef(groupHistories); historiesRef.current = groupHistories;
  const transferRef = React.useRef<{ target: string; rel: string; snapshot: EditorTransfer } | null>(null);
  const saveBusy = React.useRef(false);
  const saveProject = React.useRef(project); saveProject.current = project;
  const [saving, setSaving] = React.useState(false);
  const [cursors, setCursors] = React.useState<Record<string, { line: number; column: number }>>({});
  const [groupLayout, setGroupLayout] = React.useState<EditorGroups>(() => editorGroups());
  const groupsRef = React.useRef(groupLayout); groupsRef.current = groupLayout;
  const updateGroups = React.useCallback((change: (state: EditorGroups) => EditorGroups) => { const next = change(groupsRef.current); groupsRef.current = next; setGroupLayout(next); }, []);
  const active = groupLayout.groups.find(group => group.id === groupLayout.focused)?.active ?? null;
  const setActive = React.useCallback((value: React.SetStateAction<string | null>) => updateGroups(state => {
    const current = state.groups.find(group => group.id === state.focused)?.active ?? null;
    return selectGroupFile(state, state.focused, typeof value === 'function' ? value(current) : value);
  }), [updateGroups]);
  const [line, setLine] = React.useState<number | undefined>();
  const [column, setColumn] = React.useState<number | undefined>();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [editors, setEditors] = React.useState<{ id: string; name: string }[]>([]);
  const [error, setError] = React.useState<{ rel: string; intent: OpenIntent; line?: number; reload?: boolean; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [showOpening, setShowOpening] = React.useState(false);
  React.useEffect(() => { if (!busy) { setShowOpening(false); return; } const timer = setTimeout(() => setShowOpening(true), 200); return () => clearTimeout(timer); }, [busy]);
  const [confirmation, setConfirmation] = React.useState<{ paths: string[]; group?: string; reload?: boolean } | null>(null);
  const [comparing, setComparing] = React.useState<{ rel: string; diff: string | null } | null>(null);
  const [restoring, setRestoring] = React.useState(true);
  const [small, setSmall] = React.useState(() => window.innerWidth < 640);
  React.useEffect(() => {
    let alive = true; let cancel: (() => void) | undefined; const { token, changed } = index.beginSearch(); if (changed) bumpIndex(); setFileSearchStatus(null);
    if (!warm || !visible || collapsed || small && !browse || s.searchFilesOpen || debugVisible || !filter.trim()) return;
    const timer = setTimeout(() => { if (!indexWarm.current) return; const search = fileSearch(s.hub, project, filter, { showHidden: hidden }); cancel = search.cancel; void search.result.then((result) => { if (alive && indexWarm.current && index.acceptMatches(token, result.files)) { setFileSearchStatus({ result }); bumpIndex(); } }).catch((error: Error) => { if (alive) setFileSearchStatus({ error: error.message }); }); }, 150);
    return () => { alive = false; clearTimeout(timer); cancel?.(); };
  }, [project, filter, hidden, s.hub, directoryRevision, warm, index, visible, collapsed, small, browse, s.searchFilesOpen, debugVisible]);
  const treeSessions = React.useRef(new Map<string, DirectorySession>());
  const directorySession = (folder: string) => { let session = treeSessions.current.get(folder); if (!session) { session = createDirectorySession(); treeSessions.current.set(folder, session); } return session; };
  const treeViewport = useTreeViewport(visible && warm && !s.searchFilesOpen && !debugVisible && (small ? browse : !collapsed), `${active || ''}\0${filter}`);
  const explorer = React.useRef<PanelImperativeHandle>(null);
  const fileGroup = React.useRef<HTMLDivElement>(null);
  const explorerWidth = React.useRef(224);
  const debuggerWidth = React.useRef(280);
  React.useEffect(() => { if (debugVisible) s.setSearchFilesOpen(false); if (debugVisible || s.searchFilesOpen) { setCollapsed(false); setBrowse(true); } }, [debugVisible, s.searchFilesOpen]);
  const docsRef = React.useRef(docs); docsRef.current = docs;
  const documentPaths = docs.map(doc => doc.rel).join('\0');
  React.useEffect(() => {
    const allowed = new Set(docsRef.current.map(doc => doc.rel));
    updateGroups(state => {
      let changed = false;
      const groups = state.groups.map(group => {
        const paths = group.paths.filter(path => allowed.has(path));
        if (paths.length === group.paths.length) return group;
        changed = true; return { ...group, paths, active: paths.includes(group.active || '') ? group.active : paths[0] ?? null };
      });
      return changed ? { ...state, groups } : state;
    });
  }, [documentPaths, updateGroups]);
  const sourceRef = React.useRef({ project: s.project, threadId: s.thread?.id }); sourceRef.current = { project: s.project, threadId: s.thread?.id };
  const sequence = React.useRef(0);
  const requests = React.useRef(new Map<string, Promise<FileContent>>());
  const handledIntent = React.useRef<number | undefined>(undefined);
  const fileTabs = React.useRef<HTMLDivElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const tabSignature = JSON.stringify(docs.map(({ rel, dirty, pinned }) => [rel, dirty, pinned]));
  const focusActiveTab = () => (fileTabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ?? root.current?.querySelector<HTMLElement>('[aria-label="Open files menu"]'))?.focus({ preventScroll: true });
  const search = React.useRef<HTMLInputElement>(null);
  const searchToggle = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (searchOpen && visible && !collapsed && (!small || browse)) search.current?.focus(); }, [searchOpen, visible, collapsed, small, browse]);
  const restoreFocus = React.useRef<HTMLElement | null>(null);
  const load = React.useCallback(() => {
    if (!indexWarm.current) return;
    const token = index.beginList();
    void s.hub.call<string[]>('listFiles', project).then((next) => {
      if (indexWarm.current && index.acceptFiles(token, next)) bumpIndex();
    }).catch(() => { if (indexWarm.current && index.acceptFiles(token, [])) bumpIndex(); });
  }, [project, s.hub, index]);
  React.useEffect(() => { if (!warm) { index.release(); bumpIndex(); } }, [warm, index]);
  React.useEffect(() => { if (visible) { load(); setDirectoryRevision((value) => value + 1); } }, [visible, load]);
  React.useEffect(() => {
    const element = root.current; if (!element) return;
    const change = () => setSmall(element.getBoundingClientRect().width < 640);
    change(); const observer = new ResizeObserver(change); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (visible) explorer.current?.resize(small ? browse ? '100%' : 0 : collapsed ? 0 : debugVisible ? debuggerWidth.current : explorerWidth.current);
  }, [visible, small, browse, collapsed, debugVisible]);
  React.useEffect(() => { if (s.hub.platform === 'desktop') s.hub.call<{ id: string; name: string }[]>('editors').then(setEditors).catch(() => {}); }, [s.hub]);
  React.useLayoutEffect(() => {
    if (visible) fileTabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabSignature, visible, groupLayout.focused]);

  const read = React.useCallback((rel: string) => {
    let request = requests.current.get(rel);
    if (!request) {
      request = s.hub.call<FileContent>('readFile', project, rel).finally(() => requests.current.delete(rel));
      requests.current.set(rel, request);
    }
    return request;
  }, [project, s.hub]);

  // Reopen this folder's tabs from the last session, with any unsaved text (lib/drafts.mjs). A recovered
  // draft keeps the version it was based on, so the disk check below reports a file changed meanwhile.
  React.useEffect(() => {
    let cancelled = false;
    setRestoring(true);
    (async () => {
      const snapshot = await s.hub.call<{ editorGroups?: unknown } | null>('draft', `files:${project}`).catch(() => null);
      const saved = savedFileSession(snapshot);
      const restored = (await Promise.all(saved.tabs.map(async (tab): Promise<Doc | null> => {
        if (tab.text !== undefined) return { rel: tab.rel, size: tab.base!.length, binary: false, truncated: false, mtime: tab.mtime!, content: tab.base!, text: tab.text, dirty: true, pinned: true, mode: tab.mode, wrap: tab.wrap, recovered: true };
        try { const file = await read(tab.rel); return { ...file, rel: tab.rel, text: file.content, dirty: false, pinned: tab.pinned, mode: tab.mode, wrap: tab.wrap }; } catch { return null; }
      }))).filter((doc): doc is Doc => !!doc);
      if (cancelled || !restored.length) return;
      setDocs((open) => [...open, ...restored.filter((doc) => !open.some((item) => item.rel === doc.rel))]);
      updateGroups(() => restoreEditorGroups(snapshot?.editorGroups, restored.map(doc => doc.rel), saved.active));
      setBrowse(false);
    })().finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [project, read, s.hub]);
  // ...and keep them for the next one, once the saved ones are back.
  const sessionDraft = React.useRef<ReturnType<typeof draftWriter> | null>(null);
  React.useEffect(() => {
    let warned = false;
    const writer = draftWriter(s.hub, `files:${project}`, { onError: (e) => { if (!warned) { warned = true; toast.warning(e.message); } } });
    sessionDraft.current = writer;
    return () => { writer.dispose(); sessionDraft.current = null; };
  }, [project, s.hub]);
  React.useEffect(() => { if (!restoring) { const session = fileSession(docs, active); sessionDraft.current?.set(session ? { ...session, editorGroups: groupLayout } : null); } }, [docs, active, groupLayout, restoring]);

  const pauseFollowing = React.useRef(s.pauseFollowing); pauseFollowing.current = s.pauseFollowing;
  const openDoc = React.useCallback(async (rel: string, intent: OpenIntent = 'preview', ln?: number, col?: number, following = false, editor = false) => {
    if (!following) pauseFollowing.current();
    if (groupsRef.current.groups.length > 1) intent = 'pinned';
    setComparison(null);
    setColumn(col);
    setOpen((folders) => { const next = new Set(folders); const parts = rel.split('/'); parts.slice(0, -1).forEach((_, i) => next.add(parts.slice(0, i + 1).join('/'))); return next; });
    const id = ++sequence.current;
    setError(null);
    const existing = docsRef.current.find((doc) => doc.rel === rel);
    if (existing) {
      if (intent === 'pinned' || editor) setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, pinned: doc.pinned || intent === 'pinned' || (editor && !following), mode: editor && !doc.binary && !imageMime(rel) ? 'edit' : doc.mode } : doc));
      setActive(rel); setLine(ln); setBrowse(false); setBusy(false); setOpening(null); return;
    }
    setBusy(true); setOpening(rel);
    try {
      const file = await read(rel);
      if (id !== sequence.current) return;
      const next: Doc = { ...file, rel, text: file.content, dirty: false, pinned: intent === 'pinned', mode: imageMime(rel) || !editor && /\.(md|mdx|markdown)$/i.test(rel) ? 'preview' : 'edit' };
      if (sourceRef.current.project) rememberFile({ project: sourceRef.current.project, rel, threadId: sourceRef.current.threadId });
      setDocs((all) => openFileTab(all, next, intent));
      setActive(rel); setLine(ln); setBrowse(false);
      setOpen((folders) => { const next = new Set(folders); const parts = rel.split('/'); parts.slice(0, -1).forEach((_, i) => next.add(parts.slice(0, i + 1).join('/'))); return next; });
    } catch (cause) { if (id === sequence.current) setError({ rel, intent, line: ln, message: (cause as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }); }
    finally { if (id === sequence.current) { setBusy(false); setOpening(null); } }
  }, [read]);
  React.useEffect(() => {
    const request = s.fileToOpen;
    if (!visible || restoring || !request || request.project !== project || handledIntent.current === request.n) return;
    handledIntent.current = request.n; const focusOwner = document.activeElement;
    void openDoc(request.rel, request.intent, request.line, request.column, request.following, request.editor).then(() => {
      if (!request.following && handledIntent.current === request.n) focusEditorGroup(focusOwner);
    });
  }, [s.fileToOpen, visible, restoring, project, openDoc]);

  // A Write tool can announce a path before the file exists. Keep following that
  // intent while it is current; a click or a project switch cancels the retry.
  React.useEffect(() => {
    if (!error || !visible || !s.following || !s.fileToOpen?.following || s.fileToOpen.rel !== error.rel || s.fileToOpen.project !== project) return;
    const timer = setTimeout(() => void openDoc(error.rel, error.intent, error.line, undefined, true, true), 400);
    return () => clearTimeout(timer);
  }, [error, visible, s.following, s.fileToOpen, project, openDoc]);

  const autoOpened = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = s.thread?.id;
    if (!visible || restoring || !s.codeLayout || !id || autoOpened.current === id || !index.files || busy) return;
    if (s.fileToOpen?.project === project && !active) return;
    autoOpened.current = id;
    if (active) return;
    const recorded = s.thread?.messages.flatMap((message) => message.role === 'assistant' ? message.files.filter((file) => !file.external).map((file) => file.rel) : []).at(-1);
    const entry = recorded && index.files.includes(recorded) ? recorded : projectProfile(index.files).entry || index.files.find((file) => /^(src\/)?(main|app|index)\.[cm]?[jt]sx?$/i.test(file))
      || index.files.find((file) => /^readme\.md$/i.test(file))
      || index.files.find((file) => /\.(tsx?|jsx?|py|rs|go|java|html|css)$/i.test(file) && !/(^|\/)(node_modules|dist|build|fixtures|test|tests)\//.test(file));
    if (entry) void openDoc(entry);
  }, [visible, restoring, s.codeLayout, s.thread?.id, indexVersion, index, busy, active, project, openDoc, s.fileToOpen]);

  const watched = JSON.stringify([...new Set([...(active ? [active] : []), ...docs.map((doc) => doc.rel)])].slice(0, 24).sort());
  React.useEffect(() => {
    if (!visible) return;
    let disposed = false; let watchId = '';
    const refreshing = new Set<string>(); const again = new Set<string>();
    const refresh = async (rel: string) => {
      if (refreshing.has(rel)) { again.add(rel); return; }
      refreshing.add(rel);
      try {
        const next = await read(rel);
        if (disposed) return;
        setDocs((all) => all.map((doc) => doc.rel !== rel ? doc : doc.dirty
          ? { ...doc, diskChanged: next.content !== doc.content || next.mtime !== doc.mtime, diskError: false }
          : { ...doc, ...next, rel, text: next.content, dirty: false, diskChanged: false, diskError: false }));
      } catch { if (!disposed) setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, diskError: true } : doc)); }
      finally { refreshing.delete(rel); if (again.delete(rel) && !disposed) void refresh(rel); }
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
      else { watchId = id; setLive('Live updates'); for (const rel of JSON.parse(watched) as string[]) void refresh(rel); }
    }).catch(() => { if (!disposed) setLive('Live updates unavailable'); });
    return () => { disposed = true; if (typeof off === 'function') off(); if (watchId) s.hub.call('unwatchFiles', watchId).catch(() => {}); };
  }, [visible, project, watched, s.hub, read, load, watchRevision]);

  const doc = docs.find(item => item.rel === active) ?? null;
  const decorations = React.useMemo(() => explorerDecorations(project, repository.git, docs.filter((item) => item.dirty).map((item) => item.rel)), [project, repository.git, docs]);
  const pin = (rel: string) => setDocs((all) => all.map((doc) => doc.rel === rel ? { ...doc, pinned: true } : doc));
  const saveDocument = async (doc: Doc | null, editorHistory: EditorHistory | null, strict = false, valid?: () => boolean) => {
    if (!doc || doc.binary || doc.truncated || saveBusy.current) return;
    saveBusy.current = true; setSaving(true);
    let text = doc.text;
    try {
      const editor = editorHistory?.path === doc.rel ? editorHistory : null;
      if (editor) {
        if (saveProject.current !== project || editor.text() !== editorText(doc.text)) { toast.message('Draft changed. Save again.'); return; }
        const prepared = await editor.format(true, valid);
        if (prepared === null) return;
        text = prepared;
      }
      if (valid && !valid()) return;
      if (saveProject.current !== project || editor && editor.text() !== editorText(text)) { toast.message('Draft changed. Save again.'); return; }
      const result = await s.hub.call<{ mtime: number }>('writeFile', project, doc.rel, text, doc.mtime);
      if (saveProject.current !== project) return;
      setDocs((all) => all.map((item) => item.rel === doc.rel ? { ...item, mtime: result.mtime, dirty: editorText(item.text) !== editorText(text), content: text, diskChanged: false, diskError: false } : item));
      s.refreshGit(project);
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('tributary:eslint-check', { detail: { project, path: doc.rel, reason: 'save' } })));
      return { saved: true, path: doc.rel, mtime: result.mtime };
    } catch (e) { if (strict) throw e; toast.error((e as Error).message); }
    finally { saveBusy.current = false; setSaving(false); }
  };
  const reload = async (rel: string) => {
    try {
      const file = await read(rel);
      setDocs((all) => all.map((item) => item.rel === rel ? { ...item, ...file, text: file.content, dirty: false, diskChanged: false, diskError: false } : item));
    } catch (cause) { setError({ rel, intent: 'pinned', reload: true, message: (cause as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') }); }
  };
  const forget = (rel: string) => setDocs((all) => all.map((item) => item.rel === rel ? { ...item, recovered: false } : item));
  // The file on disk now against the unsaved text; nothing is written until the person picks a version.
  const compare = async (target: Doc) => {
    restoreFocus.current = document.activeElement as HTMLElement;
    setComparing({ rel: target.rel, diff: null });
    try { const diff = await s.hub.call<string>('compareDraft', project, target.rel, target.text); setComparing((open) => open?.rel === target.rel ? { rel: target.rel, diff } : open); }
    catch (e) { setComparing(null); toast.error((e as Error).message); }
  };
  // Chosen after comparing: write the unsaved text over whatever is on disk now.
  const overwrite = async (rel: string) => {
    const target = docsRef.current.find((item) => item.rel === rel); if (!target) return;
    try {
      const current = await read(rel).catch(() => null);
      const result = await s.hub.call<{ mtime: number }>('writeFile', project, rel, target.text, current?.mtime);
      setDocs((all) => all.map((item) => item.rel === rel ? { ...item, mtime: result.mtime, content: target.text, dirty: item.text !== target.text, diskChanged: false, diskError: false, recovered: false } : item));
      s.refreshGit(project);
    } catch (e) { toast.error((e as Error).message); }
  };
  const returnFocus = (event: Event) => {
    event.preventDefault();
    const target = restoreFocus.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else focusActiveTab();
  };
  const close = (paths: string[], confirmed = false, group = groupsRef.current.focused) => {
    const elsewhere = new Set(groupsRef.current.groups.filter(item => item.id !== group).flatMap(item => item.paths));
    if (!confirmed && docsRef.current.some((doc) => paths.includes(doc.rel) && doc.dirty && !elsewhere.has(doc.rel))) {
      restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths, group }); return;
    }
    ++sequence.current; setBusy(false); setOpening(null);
    const next = closeGroupFiles(groupsRef.current, group, paths);
    const retained = new Set(next.groups.flatMap(item => item.paths));
    updateGroups(() => next); setDocs(all => all.filter(item => retained.has(item.rel)));
    // A removed close button cannot receive focus; select its surviving neighbour.
    requestAnimationFrame(focusActiveTab);
  };
  index.derive(filter, hidden, s.compactFolders, warm);
  React.useEffect(() => { if (warm && filter.trim()) setOpen((folders) => new Set([...folders, ...index.shown.flatMap((file) => { const parts = file.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); })])); }, [indexVersion, filter, hidden, warm, index]);
  const toggle = (path: string) => setOpen((folders) => { const next = new Set(folders); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const browseFiles = () => { setBrowse(true); setCollapsed(false); setSearchOpen(true); };
  const closeSearch = () => { setSearchOpen(false); setFilter(''); searchToggle.current?.focus(); };
  const refreshFiles = () => { load(); setDirectoryRevision((value) => value + 1); setWatchRevision((value) => value + 1); };
  const startCreation = (root: string, parent: string, kind: 'file' | 'folder') => { setCreationError(''); setCreation({ project: root, kind, name: parent ? `${parent}/` : '' }); };
  const submitCreation = async (event: React.FormEvent) => {
    event.preventDefault(); if (!creation || creationBusy) return; setCreationBusy(true); setCreationError('');
    try {
      const result = await s.hub.call<{ rel: string }>('createEntry', creation.project, creation.name, creation.kind);
      setHidden(true); refreshFiles();
      const parts = result.rel.split('/'); if (creation.kind === 'file') parts.pop();
      if (creation.project === project) setOpen((old) => new Set([...old, ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]));
      else for (const folder of parts.map((_, i) => parts.slice(0, i + 1).join('/'))) if (!rootFolders[creation.project]?.has(folder)) toggleBranch(creation.project, folder);
      setCreation(null);
      if (creation.kind === 'file') { if (creation.project === project) await openDoc(result.rel, 'pinned'); else s.openFile(result.rel, undefined, 'pinned', undefined, false, creation.project); }
    } catch (error) { setCreationError((error as Error).message); } finally { setCreationBusy(false); }
  };
  React.useEffect(() => { if (!visible) return; const find = () => { browseFiles(); requestAnimationFrame(() => search.current?.focus()); }; window.addEventListener('tributary:find-file', find); return () => window.removeEventListener('tributary:find-file', find); }, [visible]);
  const label = (rel: string) => fileTabLabel(rel, docs.map((doc) => doc.rel));
  const iconButton = 'workbench-action shrink-0 [&_svg]:size-4';

  const pendingGroupFocus = React.useRef<string | null>(null);
  const focusEditorGroup = (expected?: Element | null) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const current = document.activeElement;
      if (expected !== undefined && current !== expected && current !== document.body && current !== document.documentElement) { pendingGroupFocus.current = null; return; }
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) { pendingGroupFocus.current = null; return; }
      const group = root.current?.querySelector<HTMLElement>(`[data-editor-group="${groupsRef.current.focused}"]`);
      if (group?.offsetParent) (group.querySelector<HTMLElement>('.cm-content') || group.querySelector<HTMLElement>('[role="tab"][data-state="active"]') || group).focus();
      pendingGroupFocus.current = null;
    }));
  };
  const focusGroup = (id: string) => {
    if (groupsRef.current.focused === id) return;
    ++sequence.current; setBusy(false); setOpening(null); setLine(undefined); setColumn(undefined);
    updateGroups(state => ({ ...state, focused: id }));
  };
  const splitGroup = (direction: EditorGroups['direction'], id = groupsRef.current.focused) => {
    setComparison(null); s.pauseFollowing();
    setDocs(all => all.map(item => item.pinned ? item : { ...item, pinned: true }));
    updateGroups(state => splitEditorGroup({ ...state, focused: id }, direction));
    pendingGroupFocus.current = groupsRef.current.focused; focusEditorGroup();
  };
  const moveFile = (sourceId: string, targetId: string, rel: string | null) => {
    const next = moveGroupFile(groupsRef.current, sourceId, targetId, rel);
    if (next === groupsRef.current) return;
    const history = historiesRef.current[sourceId];
    const target = groupsRef.current.groups.find(group => group.id === targetId);
    const snapshot = history?.path === rel && target?.active !== rel ? history.snapshot() : null;
    transferRef.current = snapshot && rel ? { target: targetId, rel, snapshot } : null;
    setComparison(null); s.pauseFollowing();
    ++sequence.current; setBusy(false); setOpening(null); setLine(undefined); setColumn(undefined);
    setDocs(all => all.map(item => item.rel === rel && !item.pinned ? { ...item, pinned: true } : item));
    updateGroups(() => next);
    pendingGroupFocus.current = next.focused; focusEditorGroup();
  };
  const moveCurrent = React.useRef((offset: number) => {});
  moveCurrent.current = (offset) => {
    if (offset !== -1 && offset !== 1) return;
    const state = groupsRef.current, index = state.groups.findIndex(group => group.id === state.focused);
    const target = state.groups[index + offset];
    if (target) moveFile(state.focused, target.id, state.groups[index].active);
  };
  const joinGroup = (id: string) => { updateGroups(state => joinEditorGroup(state, id)); pendingGroupFocus.current = groupsRef.current.focused; focusEditorGroup(); };
  const focusAtIndex = (index: number) => {
    const next = focusEditorGroupAt(groupsRef.current, index);
    if (!next.groups[index]) return;
    setComparison(null); s.pauseFollowing(); setBrowse(false);
    ++sequence.current; setBusy(false); setOpening(null); setLine(undefined); setColumn(undefined);
    updateGroups(() => next);
    pendingGroupFocus.current = next.focused; focusEditorGroup();
  };
  const numberedFocus = React.useRef(focusAtIndex); numberedFocus.current = focusAtIndex;
  const splitCurrent = React.useRef(splitGroup); splitCurrent.current = splitGroup;
  React.useEffect(() => {
    if (!visible) return;
    const show = (event: Event) => {
      const hide = (event as CustomEvent).detail === 'hide';
      setCollapsed(hide); setBrowse(!hide);
      if (hide) focusEditorGroup();
    };
    window.addEventListener('tributary:explorer', show);
    return () => window.removeEventListener('tributary:explorer', show);
  }, [visible]);
  React.useEffect(() => {
    if (!visible) return;
    const split = (event: Event) => splitCurrent.current((event as CustomEvent).detail === 'vertical' ? 'vertical' : 'horizontal');
    const focus = (event: Event) => numberedFocus.current((event as CustomEvent<number>).detail);
    const move = (event: Event) => moveCurrent.current((event as CustomEvent<number>).detail);
    window.addEventListener('tributary:move-editor', move);
    window.addEventListener('tributary:split-editor', split);
    window.addEventListener('tributary:focus-editor-group', focus);
    return () => { window.removeEventListener('tributary:move-editor', move); window.removeEventListener('tributary:split-editor', split); window.removeEventListener('tributary:focus-editor-group', focus); };
  }, [visible]);
  const agentCommand = React.useRef<(request: EditorCommand) => Promise<unknown>>(async () => null);
  agentCommand.current = async (request) => {
    const { action, input } = request;
    const ensure = () => { if (!request.valid() || !visible || s.workdir !== project || saveBusy.current) throw new Error('The editor is unavailable or busy.'); };
    ensure(); s.pauseFollowing();
    if (action === 'status') return { project, focused: groupsRef.current.focused, groups: groupsRef.current.groups.map(group => ({ id: group.id, active: group.active, files: group.paths })), files: docsRef.current.map(doc => ({ path: doc.rel, dirty: doc.dirty, readOnly: !!(doc.binary || doc.truncated) })) };
    if (action === 'open_file') {
      await openDoc(input.path!, 'pinned', input.line, input.column, false, true);
      const deadline = Date.now() + 5000;
      for (;;) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); ensure();
        const group = groupsRef.current.groups.find(group => group.id === groupsRef.current.focused);
        const editor = group && historiesRef.current[group.id];
        if (group?.active === input.path && editor && editor.path === input.path) return editor.inspect(input.start_line, input.count);
        if (Date.now() > deadline) throw new Error('The file could not be opened as an editable code file.');
      }
    }
    if (action === 'split_editor') { splitGroup(input.direction === 'down' ? 'vertical' : 'horizontal'); return { groups: groupsRef.current.groups.length, focused: groupsRef.current.focused }; }
    if (action === 'focus_group') { focusAtIndex((input.group || 1) - 1); return { focused: groupsRef.current.focused }; }
    const group = groupsRef.current.groups.find(group => group.id === groupsRef.current.focused);
    const doc = docsRef.current.find(doc => doc.rel === group?.active);
    const editor = group && historiesRef.current[group.id];
    if (!doc || !editor || editor.path !== doc.rel || input.path && input.path !== doc.rel) throw new Error('Open the intended code file first.');
    if (action === 'read_editor') return editor.inspect(input.start_line, input.count);
    if (doc.binary || doc.truncated || editor.inspect().revision !== input.revision) throw new Error('The editor changed or is read-only. Read its current revision first.');
    if (action === 'edit_editor') editor.agentEdit(input.revision!, input.old_text!, input.new_text!);
    else if (action === 'undo') editor.undo();
    else if (action === 'redo') editor.redo();
    else if (action === 'format') { if (await editor.format(false, request.valid) === null) throw new Error('Formatting did not complete.'); }
    else if (action === 'save_editor') { const result = await saveDocument(doc, editor, true, request.valid); if (!result) throw new Error('The file was not saved. Inspect the current draft and retry.'); return result; }
    else throw new Error('Unsupported editor command.');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    ensure(); return editor.inspect(input.start_line, input.count);
  };
  React.useEffect(() => {
    if (!visible || restoring) return;
    const handle = (event: Event) => { const request = (event as CustomEvent<EditorCommand>).detail; if (request.claimed || request.project !== project) return; request.claimed = true; void agentCommand.current(request).then(request.resolve, request.reject); };
    window.addEventListener('tributary:agent-editor', handle); return () => window.removeEventListener('tributary:agent-editor', handle);
  }, [visible, restoring, project]);
  const allDocs = docs;
  const renderGroup = (group: EditorGroup) => {
    const docs = allDocs.filter(item => group.paths.includes(item.rel));
    const active = group.active, doc = docs.find(item => item.rel === active) ?? null;
    const focused = group.id === groupLayout.focused;
    const comparison = focused ? comparisonRel : null;
    const editorHistory = groupHistories[group.id] ?? null, editorStats = groupStats[group.id];
    const documentInfo = doc ? { language: sourceLanguage(doc.rel, doc.text).label, spacing: editorSpacing(doc.rel, doc.text) } : null;
    const formatHint = doc ? formattingHint(doc.rel, doc.text) : null;
    const canFormat = !!doc && !doc.binary && !doc.truncated && !!(formatParser(doc.rel) || nativeFormatTool(doc.rel) || configuredLanguage(s.st?.settings.languageServers, doc.rel));
    const save = () => saveDocument(doc, historiesRef.current[group.id] ?? null);
    const toggleWrap = () => setDocs(all => all.map(item => item.rel === active ? { ...item, wrap: !item.wrap } : item));
    const formatActive = () => {
      if (!doc || !canFormat) return;
      setDocs(all => all.map(item => item.rel === doc.rel ? { ...item, mode: 'edit' } : item));
      requestAnimationFrame(() => requestAnimationFrame(() => { const history = historiesRef.current[group.id]; if (history?.path === doc.rel) void history.format(); }));
    };
    const select = (rel: string) => { setComparison(null); s.pauseFollowing(); ++sequence.current; setBusy(false); setOpening(null); setError(null); updateGroups(state => selectGroupFile(state, group.id, rel)); setLine(undefined); setColumn(undefined); setBrowse(false); };
  const fileNavigation = (<div className="workbench-toolbar workspace-file-navigation border-b bg-background/60 pr-2">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label={small ? debugVisible ? 'Show debugger' : 'Browse files' : collapsed ? 'Show explorer' : 'Collapse explorer'} aria-expanded={small ? browse : !collapsed} onClick={() => small ? setBrowse(!browse) : setCollapsed(!collapsed)}>{collapsed || (small && !browse) ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></TooltipTrigger><TooltipContent>{small ? 'Browse files' : collapsed ? <>Show explorer <ShortcutLabel action="files" /></> : 'Collapse explorer'}</TooltipContent></Tooltip>
        <div ref={focused ? fileTabs : undefined} className="workspace-file-strip @container relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList aria-label="Open files" variant="line" className="workspace-file-list justify-start gap-0 rounded-none p-0">
            {docs.map((item) => <div key={item.rel} className="relative flex shrink-0"><ContextMenu><ContextMenuTrigger asChild><TabsTrigger key={item.rel} value={item.rel} data-file-path={item.rel} title={item.rel} aria-label={`${item.rel}${!item.pinned ? ', preview' : ''}${item.dirty ? ', unsaved' : ''}`} onDoubleClick={() => pin(item.rel)} className={cn('workspace-file-tab h-8 min-w-0 max-w-[min(16rem,100cqw)] flex-none justify-start rounded-none border-0 px-2.5 pr-8 text-[13px] font-normal after:hidden focus-visible:ring-inset max-sm:h-11 max-sm:pr-12', !item.pinned && 'italic')}>
              <FileTypeIcon path={item.rel} /><span className="truncate">{label(item.rel)}</span>
              {item.dirty && <Circle aria-hidden="true" className="size-2 fill-current" />}
            </TabsTrigger></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={event => { if (pendingGroupFocus.current || groupsRef.current.focused !== group.id) { event.preventDefault(); focusEditorGroup(); } }}>
                <ContextMenuItem onSelect={() => { updateGroups(state => selectGroupFile(state, group.id, item.rel)); splitGroup('horizontal', group.id); }}><Columns2 />Split right</ContextMenuItem>
                <ContextMenuItem onSelect={() => { updateGroups(state => selectGroupFile(state, group.id, item.rel)); splitGroup('vertical', group.id); }}><Rows2 />Split down</ContextMenuItem>
                {groupLayout.groups.length > 1 && <ContextMenuSub><ContextMenuSubTrigger>Move into group</ContextMenuSubTrigger><ContextMenuSubContent>
                  {groupLayout.groups.map((target, index) => target.id !== group.id && <ContextMenuItem key={target.id} onSelect={() => moveFile(group.id, target.id, item.rel)}>Group {index + 1}{target.active && <span className="ml-auto max-w-40 truncate text-xs text-muted-foreground">{label(target.active)}</span>}</ContextMenuItem>)}
                </ContextMenuSubContent></ContextMenuSub>}
                <ContextMenuSeparator /><ContextMenuItem onSelect={() => close([item.rel], false, group.id)}><X />Close</ContextMenuItem>
              </ContextMenuContent></ContextMenu><Button variant="ghost" size="icon-sm" className={cn(iconButton, "absolute right-0 top-0")} aria-label={`Close ${item.rel}`} onClick={() => close([item.rel], false, group.id)}><X /></Button></div>)}
          </TabsList>
        </div>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Split editor right" disabled={!doc} onClick={(event) => splitGroup(event.altKey ? 'vertical' : 'horizontal', group.id)}><Columns2 /></Button></TooltipTrigger><TooltipContent>Split editor right <ShortcutLabel action="split-editor" /><span className="block text-xs text-muted-foreground">Alt-click to split down</span></TooltipContent></Tooltip>
        {groupLayout.groups.length > 1 && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Close editor group" onClick={() => joinGroup(group.id)}><X /></Button></TooltipTrigger><TooltipContent>Close group · keep open files</TooltipContent></Tooltip>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Open files menu" aria-busy={busy}>{showOpening ? <Spinner /> : <Ellipsis />}</Button></DropdownMenuTrigger>
          <DropdownMenuContent onCloseAutoFocus={event => { if (pendingGroupFocus.current || groupsRef.current.focused !== group.id) { event.preventDefault(); focusEditorGroup(); } }} align="end" className="max-h-[70dvh] max-w-[calc(100vw-16px)] overflow-y-auto max-sm:[&_[role=menuitem]]:min-h-11">
            <DropdownMenuItem onSelect={() => s.openPanel('preview')}>Project tools & extensions</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setChecksOpen(true)}>Lint, type check & tests…</DropdownMenuItem>
            <DropdownMenuItem disabled={s.hub.platform === 'mock'} onSelect={() => setFormatAllOpen(true)}><WandSparkles />Format all files…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc} onSelect={() => splitGroup('horizontal', group.id)}><Columns2 />Split editor right<ShortcutLabel action="split-editor" /></DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onSelect={() => splitGroup('vertical', group.id)}><Rows2 />Split editor down</DropdownMenuItem>
            {groupLayout.groups.length > 1 && <DropdownMenuSub><DropdownMenuSubTrigger disabled={!doc}>Move editor into group</DropdownMenuSubTrigger><DropdownMenuSubContent>
              {groupLayout.groups.map((target, index) => target.id !== group.id && <DropdownMenuItem key={target.id} onSelect={() => moveFile(group.id, target.id, active)}>Group {index + 1}{target.active && <span className="ml-auto max-w-40 truncate text-xs text-muted-foreground">{label(target.active)}</span>}</DropdownMenuItem>)}
            </DropdownMenuSubContent></DropdownMenuSub>}
            {groupLayout.groups.length > 1 && <DropdownMenuItem onSelect={() => updateGroups(state => ({ ...state, direction: state.direction === 'horizontal' ? 'vertical' : 'horizontal' }))}>Toggle editor layout</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Open files</DropdownMenuLabel>
            {!docs.length && <DropdownMenuItem disabled>No open files</DropdownMenuItem>}
            {docs.map((item) => <DropdownMenuItem key={item.rel} title={item.rel} aria-label={`${item.rel}${item.dirty ? ', unsaved' : ''}`} onSelect={() => { void openDoc(item.rel); }}><Check className={cn('size-4', active !== item.rel && 'invisible')} /><span className={cn('max-w-64 truncate', !item.pinned && 'italic')}>{label(item.rel)}</span>{item.dirty && <Circle className="size-2 fill-current" />}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
            {doc && <>
              {/\.(?:[cm]?js|[cm]?ts)$/i.test(doc.rel) && <DropdownMenuItem disabled={doc.dirty || doc.truncated} onSelect={() => s.openDebugger(doc.rel)}><Bug />Debug this file</DropdownMenuItem>}
              <DropdownMenuItem disabled={!canFormat} onSelect={formatActive}><WandSparkles />Format document<span className="ml-auto"><ShortcutKeys keys={['Shift', 'Alt', 'F']} platform={platform} /></span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(doc.rel).then(() => toast.success('Relative path copied'), () => toast.error('Could not copy path'))}><Copy />Copy relative path</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { const separator = project.includes('\\') ? '\\' : '/'; void navigator.clipboard.writeText(project.replace(/[\\/]$/, '') + separator + doc.rel.replaceAll('/', separator)).then(() => toast.success('Full path copied'), () => toast.error('Could not copy path')); }}><Copy />Copy full path</DropdownMenuItem>
              {s.hub.platform !== 'mock' && <DropdownMenuItem onSelect={() => void s.hub.call('revealFile', project, doc.rel).catch((e) => toast.error(e.message))}><FolderOpen />Reveal in folder</DropdownMenuItem>}
              {s.hub.platform !== 'mock' && <DropdownMenuItem onSelect={() => { const parent = doc.rel.split('/').slice(0, -1).join('/'); runInTerminal('', parent ? `${project}/${parent}` : project); }}><SquareTerminal />Open terminal here</DropdownMenuItem>}
              <DropdownMenuSeparator />
            </>}
            <DropdownMenuItem disabled={!doc || doc.pinned} onSelect={() => doc && pin(doc.rel)}><Pin />Keep open</DropdownMenuItem>
            {doc?.mode === 'edit' && !doc.binary && <DropdownMenuCheckboxItem checked={!!doc.wrap} onCheckedChange={toggleWrap}>Wrap lines</DropdownMenuCheckboxItem>}
            {doc && IMAGE.test(doc.rel) && editors.map((editor) => <DropdownMenuItem key={editor.id} onSelect={() => s.hub.call('openInEditor', editor.id, project, doc.rel).catch((e) => toast.error(e.message))}><SquareArrowOutUpRight />Open in {editor.name}</DropdownMenuItem>)}
            <DropdownMenuItem disabled={docs.length < 2} onSelect={() => close(docs.filter((item) => item.rel !== active).map((item) => item.rel))}>Close others</DropdownMenuItem>
            <DropdownMenuItem disabled={!docs.some((item) => !item.dirty)} onSelect={() => close(docs.filter((item) => !item.dirty).map((item) => item.rel))}>Close saved tabs</DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onSelect={() => { if (!doc) return; if (doc.dirty) { restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths: [doc.rel], reload: true }); } else void reload(doc.rel); }}><RotateCw />Reload from disk</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!docs.length} onSelect={() => setSwitcherOpen(true)}>Switch file…<span className="ml-auto text-xs text-muted-foreground">Ctrl+Tab</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>);

    return <Tabs key={group.id} value={active ?? ''} onValueChange={select} data-editor-group={group.id} data-focused={focused} tabIndex={-1} aria-label={`Editor group ${groupLayout.groups.indexOf(group) + 1}`} onPointerDownCapture={() => focusGroup(group.id)} onFocusCapture={() => focusGroup(group.id)} className="editor-group flex h-full min-h-0 min-w-0 flex-col gap-0 overflow-hidden">
      {fileNavigation}
            {comparison ? <WorkspaceFileChange bridge={s.hub} project={project} rel={comparison} revision={`${repository.revision}:${directoryRevision}`} visible={visible} dirty={docs.some((item) => item.rel === comparison && item.dirty)} deleted={changedFiles.some((item) => item.rel === comparison && item.status === 'D')} onEdit={() => { const rel = comparison; setComparison(null); void openDoc(rel, 'pinned', undefined, undefined, false, true); }} onClose={() => { setComparison(null); if (!docs.length && small) setBrowse(true); }} /> : doc ? <>
              <div className="workspace-file-actions flex h-7 min-w-0 shrink-0 items-center border-b px-3 max-sm:h-11">
                <nav aria-label="File breadcrumbs" title={doc.rel} className="min-w-0 flex-1 overflow-hidden text-xs text-muted-foreground"><ol className="flex min-w-0 items-center gap-1">
                  {(doc.rel.split('/').length > 3 ? ['…', ...doc.rel.split('/').slice(-2)] : doc.rel.split('/')).map((part, index, parts) => <li key={index} className={cn('flex min-w-0 items-center gap-1', index === parts.length - 1 && 'flex-1')} >{index > 0 && <ChevronRight className="size-3 shrink-0" />}<span className="truncate" aria-current={index === parts.length - 1 ? 'page' : undefined}>{part}</span></li>)}
                </ol></nav>
                {doc.mode === 'edit' && !doc.binary && <DocumentOutline path={doc.rel} text={doc.text} onSelect={(ln, col) => void openDoc(doc.rel, 'pinned', ln, col)} />}
              </div>
              {doc.mode === 'edit' && !doc.binary && formatHint && (formatHint === 'Compact code' || !doc.wrap) && <div role="group" aria-label="Formatting actions" className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1">{formatHint}</span>{canFormat && <Tooltip><TooltipTrigger asChild><Button size="xs" variant="ghost" onClick={formatActive}><WandSparkles />Format document</Button></TooltipTrigger><TooltipContent>Format indentation and line breaks <ShortcutKeys keys={['Shift', 'Alt', 'F']} platform={platform} /></TooltipContent></Tooltip>}{!doc.wrap && <Button size="xs" variant="ghost" onClick={toggleWrap}><WrapText />Wrap lines</Button>}<Button size="xs" variant="ghost" onClick={() => s.openSettings('language-tools')}>Formatting tools</Button></div>}
              {(doc.diskChanged || doc.diskError) ? <div role="status" className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted px-3 py-1 text-xs"><span className="flex-1">{doc.diskError ? 'File unavailable. Draft kept.' : 'Changed on disk. Draft kept.'}</span>{doc.dirty && <Button variant="ghost" size="sm" onClick={() => void compare(doc)}>Compare</Button>}<Button variant="ghost" size="sm" onClick={() => { if (doc.dirty) { restoreFocus.current = document.activeElement as HTMLElement; setConfirmation({ paths: [doc.rel], reload: true }); } else void reload(doc.rel); }}>Reload</Button></div>
                : doc.recovered && doc.dirty && <div role="status" className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted px-3 py-1 text-xs"><span className="flex-1">Unsaved changes restored from your last session.</span><Button variant="ghost" size="sm" onClick={() => void compare(doc)}>Compare</Button><Button variant="ghost" size="sm" onClick={() => forget(doc.rel)}>Keep</Button></div>}
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {docs.map((item) => <TabsContent key={item.rel} value={item.rel} tabIndex={-1} className="h-full min-h-0">
                  {item.rel === active && (item.binary && !IMAGE.test(item.rel) ? <p className="p-6 text-center text-sm text-muted-foreground">Binary file · {item.size.toLocaleString()} bytes</p>
                    : item.mode === 'preview' && previewable(item.rel) ? <FilePreview doc={item} project={project} />
                      : <CodeEditor takeTransfer={() => { const saved = transferRef.current; if (!saved || saved.target !== group.id || saved.rel !== item.rel) return null; transferRef.current = null; return saved.snapshot; }} active={visible} keepAlive={saving} onReview={() => void reviewSaved(item.rel)} onChangeStats={stats => setGroupStats(all => ({ ...all, [group.id]: stats }))} followChanges={s.following && active === item.rel} onHistoryChange={history => setGroupHistories(all => ({ ...all, [group.id]: history }))} onNavigate={s.pauseFollowing} onDiagnostics={updateLiveDiagnostics} project={project} path={item.rel} value={item.text} line={focused ? line : undefined} column={focused ? column : undefined} readOnly={item.truncated} diagnostics={!item.dirty && checkResult && item.mtime <= checkResult.startedAt ? checkResult.diagnostics.filter((d) => d.rel === item.rel) : []} wrap={item.wrap} onToggleWrap={toggleWrap} onCursorChange={(position) => setCursors((all) => all[`${group.id}:${item.rel}`]?.line === position.line && all[`${group.id}:${item.rel}`]?.column === position.column ? all : { ...all, [`${group.id}:${item.rel}`]: position })} onSave={save} onChange={(value) => { s.pauseFollowing(); setDocs((all) => all.map((current) => current.rel === item.rel ? { ...current, text: value, dirty: value !== current.content, pinned: true, recovered: false } : current)); }} />)}
                </TabsContent>)}
              </div>
              {!IMAGE.test(doc.rel) && <div className="workspace-file-footer flex min-w-0 shrink-0 items-center gap-1 border-t px-2">
                <Popover><PopoverTrigger asChild><button type="button" aria-label="Document information" className="editor-status-info flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded px-1 text-left text-xs tabular-nums text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  {doc.mode === 'edit' && !doc.binary ? <><span role="status" aria-live="off" aria-label="Editor position" className="shrink-0 whitespace-nowrap">Ln {cursors[`${group.id}:${doc.rel}`]?.line ?? 1}<span className="editor-cursor-column">, Col {cursors[`${group.id}:${doc.rel}`]?.column ?? 1}</span></span><span className="editor-file-details min-w-0 truncate">{documentInfo!.language} · {documentInfo!.spacing.useTabs ? 'Tabs' : 'Spaces'}: {documentInfo!.spacing.tabSize} · UTF-8 · {doc.content.includes('\r\n') ? 'CRLF' : 'LF'}{doc.truncated && ' · Read only'}</span></> : <span className="truncate">{live}</span>}
                </button></PopoverTrigger><PopoverContent align="start" side="top" className="w-72 max-w-[calc(100vw-16px)] text-xs"><p className="mb-3 break-all font-medium">{doc.rel}</p><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-muted-foreground"><dt>Language</dt><dd className="text-foreground">{documentInfo!.language}</dd><dt>Indentation</dt><dd>{documentInfo!.spacing.useTabs ? 'Tabs' : 'Spaces'}: {documentInfo!.spacing.tabSize}</dd><dt>Encoding</dt><dd>UTF-8 · {doc.content.includes('\r\n') ? 'CRLF' : 'LF'}</dd><dt>File state</dt><dd>{doc.truncated ? 'Read only' : doc.dirty ? 'Unsaved changes' : 'Saved'}</dd><dt>Updates</dt><dd>{live}</dd></dl></PopoverContent></Popover>
                {editorStats?.rel === doc.rel && !!((editorStats.added || 0) + (editorStats.removed || 0)) && <span className="editor-status-changes shrink-0"><LineChangeCount {...editorStats} /></span>}

                <div role="group" aria-label="File actions" className="flex shrink-0 items-center gap-0.5">
                {doc.mode === 'edit' && !doc.binary && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Format document" disabled={!canFormat} onClick={formatActive}><WandSparkles /></Button></TooltipTrigger><TooltipContent>Format document <ShortcutKeys keys={['Shift', 'Alt', 'F']} platform={platform} /></TooltipContent></Tooltip>}
                {doc.mode === 'edit' && !doc.binary && <>
                  <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Undo edit" disabled={doc.truncated || editorHistory?.path !== doc.rel || !editorHistory.canUndo} onClick={() => editorHistory?.undo()}><Undo2 /></Button></TooltipTrigger><TooltipContent>Undo edit <ShortcutKeys keys={['Mod', 'Z']} platform={platform} /></TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Redo edit" disabled={doc.truncated || editorHistory?.path !== doc.rel || !editorHistory.canRedo} onClick={() => editorHistory?.redo()}><Redo2 /></Button></TooltipTrigger><TooltipContent>Redo edit <ShortcutKeys keys={platform === 'mac' ? ['Mod', 'Shift', 'Z'] : ['Mod', 'Y']} platform={platform} /></TooltipContent></Tooltip>
                </>}
                <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Review saved file changes" onClick={() => void reviewSaved(doc.rel)}><GitCompareArrows /></Button></TooltipTrigger><TooltipContent>Review saved changes</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Project checks" aria-pressed={checksOpen} onClick={() => setChecksOpen((open) => !open)}><CircleAlert /></Button></TooltipTrigger><TooltipContent>Lint, type check & tests</TooltipContent></Tooltip>
                {doc.mode === 'edit' && !doc.binary && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Wrap lines" aria-pressed={!!doc.wrap} onClick={toggleWrap}><WrapText /></Button></TooltipTrigger><TooltipContent>Wrap lines <ShortcutKeys keys={['Alt', 'Z']} platform={platform} /></TooltipContent></Tooltip>}
                {previewable(doc.rel) && !doc.binary && !IMAGE.test(doc.rel) && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label={doc.mode === 'edit' ? 'Preview file' : 'Edit file'} onClick={() => setDocs((all) => all.map((item) => item.rel === doc.rel ? { ...item, mode: item.mode === 'edit' ? 'preview' : 'edit' } : item))}>{doc.mode === 'edit' ? <Eye /> : <Pencil />}</Button></TooltipTrigger><TooltipContent>{doc.mode === 'edit' ? 'Preview' : 'Edit'}</TooltipContent></Tooltip>}
                {editors.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(iconButton, 'editor-secondary-action')} aria-label="Open in editor" title="Open in editor"><SquareArrowOutUpRight /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-sm:[&_[role=menuitem]]:min-h-11"><DropdownMenuLabel>Open in editor</DropdownMenuLabel>{editors.map((editor) => <DropdownMenuItem key={editor.id} onClick={() => s.hub.call('openInEditor', editor.id, project, doc.rel, line).catch((e) => toast.error(e.message))}>{editor.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
                {!doc.binary && <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} disabled={saving || !doc.dirty || doc.truncated} aria-label="Save file" aria-busy={saving} onClick={save}><Save /></Button></TooltipTrigger><TooltipContent>Save <ShortcutKeys keys={['Mod', 'S']} platform={platform} /></TooltipContent></Tooltip>}
                <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} aria-label="Editor actions"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top" className="max-h-[70dvh] max-w-[calc(100vw-16px)] overflow-y-auto max-sm:[&_[role^=menuitem]]:min-h-11">
                  <DropdownMenuLabel>Editor actions</DropdownMenuLabel>
                  <DropdownMenuItem disabled={!canFormat} onSelect={formatActive}><WandSparkles />Format document<ShortcutKeys keys={['Shift', 'Alt', 'F']} platform={platform} /></DropdownMenuItem>
                  <DropdownMenuItem disabled={doc.truncated || editorHistory?.path !== doc.rel || !editorHistory.canUndo} onSelect={() => editorHistory?.undo()}><Undo2 />Undo<ShortcutKeys keys={['Mod', 'Z']} platform={platform} /></DropdownMenuItem>
                  <DropdownMenuItem disabled={doc.truncated || editorHistory?.path !== doc.rel || !editorHistory.canRedo} onSelect={() => editorHistory?.redo()}><Redo2 />Redo<ShortcutKeys keys={platform === 'mac' ? ['Mod', 'Shift', 'Z'] : ['Mod', 'Y']} platform={platform} /></DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={!!doc.wrap} onCheckedChange={toggleWrap}>Wrap lines<ShortcutKeys keys={['Alt', 'Z']} platform={platform} /></DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void reviewSaved(doc.rel)}><GitCompareArrows />Review saved changes</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setChecksOpen(true)}><CircleAlert />Lint, type check & tests</DropdownMenuItem>
                  {previewable(doc.rel) && !doc.binary && <DropdownMenuItem onSelect={() => setDocs((all) => all.map((item) => item.rel === doc.rel ? { ...item, mode: item.mode === 'edit' ? 'preview' : 'edit' } : item))}><Eye />{doc.mode === 'edit' ? 'Preview file' : 'Edit file'}</DropdownMenuItem>}
                  {editors.map((editor) => <DropdownMenuItem key={editor.id} onSelect={() => void s.hub.call('openInEditor', editor.id, project, doc.rel, line).catch((error: Error) => toast.error(error.message))}><SquareArrowOutUpRight />Open in {editor.name}</DropdownMenuItem>)}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={saving || !doc.dirty || doc.truncated || doc.binary} onSelect={() => void save()}><Save />Save file<ShortcutKeys keys={['Mod', 'S']} platform={platform} /></DropdownMenuItem>
                </DropdownMenuContent></DropdownMenu>
                </div>
              </div>}
            </> : <Empty className="h-full border-0 p-4"><EmptyHeader><EmptyMedia variant="icon"><ImageIcon /></EmptyMedia><EmptyTitle>Select a file</EmptyTitle></EmptyHeader><EmptyContent><Button variant="outline" size="sm" onClick={browseFiles}><FolderOpen />Browse files</Button></EmptyContent></Empty>}
    </Tabs>;
  };

  return <div ref={root} className="relative flex h-full min-h-0 flex-col text-[13px]">
    <FileSwitcher visible={visible} paths={docs.filter(doc => groupLayout.groups.find(group => group.id === groupLayout.focused)?.paths.includes(doc.rel)).map(doc => doc.rel)} active={active} open={switcherOpen} setOpen={setSwitcherOpen} onSelect={(rel) => void openDoc(rel, 'pinned')} onRestoreFocus={focusEditorGroup} />
    <div className="flex min-h-0 flex-1 flex-col gap-0">
      {busy && <span role="status" className="sr-only">Opening file…</span>}
      {error && <div role="alert" className="absolute inset-x-0 top-10 z-20 flex items-center gap-1 border-b bg-popover px-3 py-1 text-xs max-sm:top-11"><span className="min-w-0 flex-1 truncate" title={`${error.rel}: ${error.message}`}>Couldn’t open {error.rel.split('/').pop()}. {error.message}</span><Button variant="ghost" size="sm" onClick={() => { if (error.reload) { setError(null); void reload(error.rel); } else void openDoc(error.rel, error.intent, error.line); }}>Retry</Button><Button variant="ghost" size="icon-sm" aria-label="Dismiss file error" onClick={() => setError(null)}><X /></Button></div>}
      <ResizablePanelGroup id={`files-${project}`} elementRef={fileGroup} className="min-h-0 flex-1" disabled={small || collapsed} onLayoutChanged={(layout, meta) => { if (meta.isUserInteraction && !small && !collapsed && fileGroup.current) (debugVisible ? debuggerWidth : explorerWidth).current = Math.min(360, Math.max(debugVisible ? 224 : 176, layout[`explorer-${project}`] * (fileGroup.current.clientWidth - 1) / 100)); }}>
        <ResizablePanel id={`explorer-${project}`} panelRef={explorer} defaultSize={small ? browse ? '100%' : 0 : debugVisible ? 280 : 224} minSize={small ? browse ? '100%' : 0 : collapsed ? 0 : debugVisible ? 224 : 176} maxSize={small ? browse ? '100%' : 0 : collapsed ? 0 : 360} groupResizeBehavior="preserve-pixel-size" className="h-full">
          {s.searchFilesOpen ? <div className={cn('h-full min-h-0', (small ? !browse : collapsed) && 'hidden')}><ProjectSearch project={project} visible={visible} onClose={() => s.setSearchFilesOpen(false)} onOpen={(rel, line, column) => { void openDoc(rel, 'pinned', line, column, false, true); setBrowse(false); }} /></div> : debugVisible ? <div className={cn('h-full min-h-0', (small ? !browse : collapsed) && 'hidden')}><DebugSidebar compact={small} onShowConsole={() => { if (small) setBrowse(false); }} /></div> : <div className={cn('workspace-explorer flex h-full min-h-0 flex-col bg-background/50', (small ? !browse : collapsed) && 'hidden')}>
            <div role="group" aria-label="File explorer" className="workbench-toolbar gap-0.5 border-b pr-2 pl-3">
              <ProjectMenu projectPath={owner}><button aria-label="Explorer project options" className="flex min-w-0 flex-1 items-center gap-1 rounded text-left text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring" title={project}><span className="truncate">{s.st?.projects.find((entry) => entry.path === project)?.name || project.split('/').pop()}</span><ChevronRight className="size-3 shrink-0 rotate-90 text-muted-foreground" /></button></ProjectMenu>
              <Tooltip><TooltipTrigger asChild><Button ref={searchToggle} variant={searchOpen ? 'secondary' : 'ghost'} size="icon-sm" className={cn(iconButton, 'text-muted-foreground')} aria-label="Find a file" aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}><Search /></Button></TooltipTrigger><TooltipContent>Find a file <ShortcutLabel action="find-file" /></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="New file" onClick={() => startCreation(project, '', 'file')}><FilePlus /></Button></TooltipTrigger><TooltipContent>New file</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={iconButton} aria-label="New folder" onClick={() => startCreation(project, '', 'folder')}><FolderPlus /></Button></TooltipTrigger><TooltipContent>New folder</TooltipContent></Tooltip>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className={cn(iconButton, 'relative text-muted-foreground')} aria-label="Explorer options"><Ellipsis />{hidden && <span className="absolute top-1 right-1 size-1 rounded-full bg-foreground" />}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 max-sm:[&_[role^=menuitem]]:min-h-11">
                  <DropdownMenuItem onSelect={() => startCreation(project, '', 'file')}><FilePlus />New file…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => startCreation(project, '', 'folder')}><FolderPlus />New folder…</DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={hidden} onCheckedChange={setHidden}>Show hidden files</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={s.compactFolders} onCheckedChange={s.setCompactFolders}>Compact folders</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={s.stickyFolders} onCheckedChange={s.setStickyFolders}>Sticky folders</DropdownMenuCheckboxItem>
                  <DropdownMenuItem onSelect={refreshFiles}><RefreshCw />Refresh files</DropdownMenuItem>
                  <DropdownMenuItem disabled={!open.size} onSelect={() => setOpen(new Set())}>Collapse folders</DropdownMenuItem>
                  {!small && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setCollapsed(true)}><PanelLeftClose />Collapse explorer</DropdownMenuItem></>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex shrink-0 items-center justify-between border-b px-2 py-1"><span className="px-1 text-xs text-muted-foreground">Explorer</span><div className="flex items-center gap-1"><Button size="xs" variant="ghost" aria-label="Show workspace changes" onClick={() => { void s.openReview(); }}><GitCompareArrows />Changes<span className="text-xs tabular-nums text-muted-foreground">{changedFiles.length}</span></Button><Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className={iconButton} aria-label="Hide file explorer" onClick={() => { if (small) setBrowse(false); else setCollapsed(true); focusEditorGroup(); }}><PanelLeftClose /></Button></TooltipTrigger><TooltipContent>Hide file explorer</TooltipContent></Tooltip></div></div>
            <>
            {searchOpen && <div id={searchId} className="flex shrink-0 items-center gap-1 border-b p-1.5">
              <Input ref={search} value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); } }} placeholder="Find a file…" aria-label="Find a file" className="h-8 min-w-0 bg-transparent text-[13px] shadow-none max-sm:h-11" />
              <Button variant="ghost" size="icon-sm" className={iconButton} aria-label="Close file search" onClick={closeSearch}><X /></Button>
            </div>}
            <div ref={treeViewport} className="min-h-0 flex-1 overflow-auto px-1 pt-0.5 pb-2" role="region" aria-label="Project files">
              {warm && <>
              {!filter.trim() ? roots.length > 1 ? roots.map((folder) => <section key={folder} aria-label={`Folder ${folder}`}>
                <WorkspaceFolderRow folder={folder} owner={owner} expanded={expandedRoots.has(folder)} onToggle={() => toggleRoot(folder)} onRemoved={onFolderRemoved} />
                {expandedRoots.has(folder) && <div className="pl-2"><DirectoryTree session={directorySession(folder)} createEntry={(parent, kind) => startCreation(folder, parent, kind)} bridge={s.hub} project={folder} active={folder === project ? active : null} openFile={(rel, intent) => { if (folder === project) void openDoc(rel, intent); else s.openFile(rel, undefined, intent, undefined, false, folder); }} revision={directoryRevision} expanded={rootFolders[folder] || EMPTY_BRANCHES} toggle={(rel) => toggleBranch(folder, rel)} loading={folder === project ? opening : null} hidden={hidden} compact={s.compactFolders} sticky={s.stickyFolders} chains={folder === project ? index.chains : EMPTY_CHAINS} decorations={folder === project ? decorations : undefined} reviewFile={folder === project ? reviewSaved : undefined} /></div>}
              </section>) : <DirectoryTree session={directorySession(project)} createEntry={(parent, kind) => startCreation(project, parent, kind)} bridge={s.hub} project={project} active={active} openFile={openDoc} revision={directoryRevision} expanded={open} toggle={toggle} loading={opening} hidden={hidden} compact={s.compactFolders} sticky={s.stickyFolders} chains={index.chains} decorations={decorations} reviewFile={reviewSaved} />
                : index.files == null ? <div className="grid place-items-center p-6"><Spinner /></div>
                  : index.tree.map((node) => <TreeNode key={node.path} n={node} depth={0} open={open} active={active} onOpen={openDoc} toggle={toggle} loading={opening} decorations={decorations} />)}
              {filter.trim() && fileSearchStatus && (fileSearchStatus.error || fileSearchStatus.result?.limited || fileSearchStatus.result?.unreadable) ? <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{fileSearchStatus.error || `${fileSearchStatus.result!.files.length} of ${fileSearchStatus.result!.total} files${fileSearchStatus.result!.unreadable ? ` · ${fileSearchStatus.result!.unreadable} folders unavailable` : ''}. Refine the filename to narrow results.`}</p> : null}
              {filter.trim() && index.files && !index.shown.length && <p className="p-3 text-xs text-muted-foreground">No matching files.</p>}
              </>}
            </div>
            <ExplorerOutline active={visible && !s.searchFilesOpen && !debugVisible && (small ? browse : !collapsed)} path={doc && !doc.binary ? doc.rel : null} text={doc?.text || ''} line={doc ? cursors[doc.rel]?.line || 1 : 1} onSelect={(line, column) => { if (doc) void openDoc(doc.rel, 'pinned', line, column); }} /></>

          </div>}
        </ResizablePanel>
        <ResizableHandle aria-label="Resize file explorer" title="Arrow keys resize; Enter resets" onDoubleClick={() => { explorerWidth.current = 224; explorer.current?.resize(224); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); explorerWidth.current = 224; explorer.current?.resize(224); } }} className={small || collapsed ? 'hidden' : ''} />
        <ResizablePanel id={`reader-${project}`} minSize={small ? browse ? 0 : '100%' : 144} maxSize={small && browse ? 0 : '100%'} className="h-full min-w-0">
          <div className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', small && browse && 'hidden')}>
            {debugVisible && <div className="debug-control-strip"><DebugControls /></div>}
            <ResizablePanelGroup id={`editor-groups-${project}`} orientation={small ? 'vertical' : groupLayout.direction} className="min-h-0 min-w-0 flex-1">
              {groupLayout.groups.map((group, index) => <React.Fragment key={group.id}>
                {index > 0 && <ResizableHandle aria-label="Resize editor groups" />}
                <ResizablePanel id={`${project}-${group.id}`} minSize={`${Math.min(20, 60 / groupLayout.groups.length)}%`} defaultSize={`${100 / groupLayout.groups.length}%`} className="min-h-0 min-w-0">{renderGroup(group)}</ResizablePanel>
              </React.Fragment>)}
            </ResizablePanelGroup>
            {debugVisible && <React.Suspense fallback={<p role="status" className="border-t p-2 text-xs">Opening console…</p>}><DebugConsole /></React.Suspense>}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <FormatProjectDialog open={formatAllOpen} onOpenChange={setFormatAllOpen} project={project} getUnsaved={() => docsRef.current.filter((item) => item.dirty).map((item) => item.rel)} onApplied={() => { refreshFiles(); s.refreshGit(project); }} />
      {checksOpen && <div className="h-[min(300px,45%)] min-h-40 shrink-0 border-t"><ProjectChecks visible={visible} staleFiles={docs.filter((d) => d.dirty || (checkResult && d.mtime > checkResult.startedAt)).map((d) => d.rel)} liveDiagnostics={liveDiagnostics.filter((d) => d.rel === active && docs.some((doc) => doc.rel === active && doc.mode === 'edit'))} project={project} onClose={() => setChecksOpen(false)} onResult={setCheckResult} /></div>}
    </div>
    <Dialog open={!!creation} onOpenChange={(open) => { if (!open && !creationBusy) setCreation(null); }}>
      <DialogContent className="sm:max-w-sm"><form onSubmit={submitCreation} className="space-y-4">
        <DialogHeader><DialogTitle>New {creation?.kind}</DialogTitle><DialogDescription>Enter a name or a path inside an existing folder.</DialogDescription></DialogHeader>
        <Input autoFocus aria-label="File or folder name" value={creation?.name || ''} onChange={(event) => { setCreationError(''); setCreation((old) => old && { ...old, name: event.target.value }); }} disabled={creationBusy} />
        {creationError && <p role="alert" className="text-sm text-destructive">{creationError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={creationBusy} onClick={() => setCreation(null)}>Cancel</Button><Button type="submit" disabled={creationBusy || !creation?.name.trim()}>{creationBusy ? 'Creating…' : 'Create'}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
    <AlertDialog open={!!confirmation} onOpenChange={(isOpen) => { if (!isOpen) setConfirmation(null); }}>
      <AlertDialogContent className="max-w-[calc(100vw-32px)] max-sm:[&_button]:min-h-11" onCloseAutoFocus={returnFocus}>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription className="break-words">{confirmation?.paths.filter((path) => docs.find((doc) => doc.rel === path)?.dirty).join(', ')}<br />Your edits will be lost.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!confirmation) return; if (confirmation.reload) void reload(confirmation.paths[0]); else close(confirmation.paths, true, confirmation.group); setConfirmation(null); }}>Discard changes</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={!!comparing} onOpenChange={(isOpen) => { if (!isOpen) setComparing(null); }}>
      <DialogContent className="flex max-h-[85dvh] max-w-[calc(100vw-32px)] flex-col sm:max-w-3xl max-sm:[&_button]:min-h-11" onCloseAutoFocus={returnFocus}>
        <DialogHeader><DialogTitle>Compare unsaved changes</DialogTitle><DialogDescription className="break-words">{comparing?.rel}: the file on disk (−) and your unsaved version (+). Nothing is written until you choose.</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">{comparing?.diff == null ? <p role="status" className="p-3 text-sm text-muted-foreground">Comparing…</p> : comparing.diff ? <FileDiff diff={comparing.diff} /> : <p className="p-3 text-sm text-muted-foreground">Your unsaved version matches the file on disk.</p>}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setComparing(null)}>Keep editing</Button>
          <Button variant="destructive" disabled={comparing?.diff == null} onClick={() => { if (!comparing) return; setComparing(null); void reload(comparing.rel); }}>Discard my changes</Button>
          <Button disabled={comparing?.diff == null} onClick={() => { if (!comparing) return; setComparing(null); void overwrite(comparing.rel); }}>Save my version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
