import * as React from 'react';
import {
  BookOpen, Code2, File, GitCompareArrows, Globe, RotateCw, X, Maximize2, Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useSidebar } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { FilesTab } from '@/components/workspace-files';
import { MemoryPanel } from '@/components/memory-panel';
import { FileDiff } from '@/components/file-diff';
import { CommentTray, addComment, removeComment, useComments, useCommentsKey } from '@/components/review-comments';
import { ReviewTab } from '@/components/review-panel';
import { ago } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useStore, type PanelTab } from '@/store';
import type { ThreadChange } from '@/types';

const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'files', label: 'Files', icon: <Code2 /> },
  { id: 'review', label: 'Changes', icon: <GitCompareArrows /> },
  { id: 'memory', label: 'Memory', icon: <BookOpen /> },
  { id: 'preview', label: 'Preview', icon: <Globe /> },
];

// ---------- Changes: every file the thread touched, and what each turn did to it
function ChangesTab() {
  const s = useStore();
  const [list, setList] = React.useState<ThreadChange[] | null>(null);
  const [sel, setSel] = React.useState<{ rel: string; messageId: string } | null>(null);
  const [diff, setDiff] = React.useState<string | null>(null);
  // One turn's part of the change, or the file's whole change over the conversation.
  const [scope, setScope] = React.useState<'turn' | 'conversation'>('turn');
  const commentsKey = useCommentsKey(); const comments = useComments(commentsKey);
  const tid = s.thread?.id; const count = s.thread?.messages.length ?? 0;
  React.useEffect(() => { if (tid) s.hub.call<ThreadChange[]>('threadChanges', tid).then(setList).catch(() => setList([])); else setList([]); }, [tid, count, s.hub]);
  React.useEffect(() => {
    if (!sel || !tid) return; setDiff(null);
    s.hub.call<string>(scope === 'turn' ? 'turnDiff' : 'conversationDiff', tid, sel.messageId, sel.rel).then(setDiff).catch((e) => setDiff(`Could not load this change: ${e.message}`));
  }, [sel, tid, s.hub, scope, count]);
  // Comments go to the agent whose turn made the change.
  const author = sel ? list?.find((f) => f.rel === sel.rel)?.turns.find((t) => t.messageId === sel.messageId)?.agent : undefined;
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
          : <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={sel.rel}>{sel.rel}</span>
              <div role="group" aria-label="How much of the change" className="flex gap-1">
                <Button size="xs" variant={scope === 'turn' ? 'secondary' : 'ghost'} aria-pressed={scope === 'turn'} onClick={() => setScope('turn')}>This turn</Button>
                <Button size="xs" variant={scope === 'conversation' ? 'secondary' : 'ghost'} aria-pressed={scope === 'conversation'} onClick={() => setScope('conversation')}>Whole conversation</Button>
              </div>
            </div>
            <CommentTray commentsKey={commentsKey} />
            {diff == null ? <div className="grid place-items-center p-8"><Spinner /></div>
              : diff ? <FileDiff diff={diff} comments={comments.filter((c) => c.file === sel.rel)} onComment={(c) => commentsKey && addComment(commentsKey, { ...c, file: sel.rel, agent: author })} onRemoveComment={(id) => commentsKey && removeComment(commentsKey, id)} />
                : <p className="text-sm text-muted-foreground">{scope === 'turn' ? 'This turn made no net change to the file.' : 'The file is back to how it was before this conversation.'}</p>}
          </div>}
      </div>
    </div>
  );
}

// ---------- Files: tree + tabs + real editor + previews
// ---------- Memory: shared facts and the work log every agent reads
const MemoryTab = MemoryPanel;

// ---------- Preview: the app you are building, served locally
function PreviewTab() {
  const s = useStore();
  const [url, setUrl] = React.useState(() => { try { return localStorage.getItem('tributary.previewUrl') || 'http://localhost:3000'; } catch { return 'http://localhost:3000'; } });
  const [shown, setShown] = React.useState(url); const [n, setN] = React.useState(0);
  const go = () => { const u = /^https?:\/\//.test(url) ? url : `http://${url}`; setShown(u); setN((x) => x + 1); try { localStorage.setItem('tributary.previewUrl', u); } catch { /* ignore */ } };
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(shown);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="workbench-toolbar gap-1 border-b px-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Preview address" className="h-7 font-mono text-xs" placeholder="http://localhost:3000" />
        <Button className="workbench-action" size="icon-sm" variant="ghost" type="submit" aria-label="Reload preview"><RotateCw /></Button>
        <Button className="h-8 max-sm:h-11" size="xs" variant="ghost" type="button" onClick={() => s.hub.call('openExternal', shown)}>Open in browser</Button>
      </form>
      {local && s.hub.platform !== 'vscode'
        ? <iframe key={n} title="App preview" src={shown} className="min-h-0 flex-1 bg-white" />
        : <p className="p-6 text-center text-sm text-muted-foreground">{local ? 'Use “Open in browser” to view it from VS Code.' : 'Only local addresses (localhost or 127.0.0.1) can be previewed here. Start your dev server, for example with npm run dev in the terminal.'}</p>}
    </div>
  );
}

export function WorkspacePanel() {
  const s = useStore();
  const mobile = useIsMobile();
  const Heading = mobile || s.workspaceExpanded ? 'h1' : 'h2';
  const { setOpen: setSidebarOpen } = useSidebar();
  const sidebarSetter = React.useRef(setSidebarOpen);
  React.useEffect(() => { sidebarSetter.current = setSidebarOpen; }, [setSidebarOpen]);
  React.useEffect(() => {
    if (!s.panel.open) return;
    const constrained = window.matchMedia('(min-width: 768px) and (max-width: 1199px)');
    const collapse = () => { if (constrained.matches) sidebarSetter.current(false); };
    collapse(); constrained.addEventListener('change', collapse);
    return () => constrained.removeEventListener('change', collapse);
  }, [s.panel.open]);
  const [fileProjects, setFileProjects] = React.useState<string[]>([]);
  const [memoryOpened, setMemoryOpened] = React.useState(s.panel.tab === 'memory');
  React.useEffect(() => { if (s.panel.tab === 'memory') setMemoryOpened(true); }, [s.panel.tab]);
  const currentFilesProject = s.panel.tab === 'files' ? s.workdir : null;
  React.useEffect(() => { if (currentFilesProject) setFileProjects((projects) => projects.includes(currentFilesProject) ? projects : [...projects, currentFilesProject]); }, [currentFilesProject]);
  const projects = currentFilesProject && !fileProjects.includes(currentFilesProject) ? [...fileProjects, currentFilesProject] : fileProjects;
  const changed = s.git?.changed.length ?? 0;
  const selectedTab = s.panel.tab === 'changes' ? 'review' : s.panel.tab;
  return (
    <aside aria-label="Workspace" className="workspace-surface flex h-full min-w-0 flex-col bg-card max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] max-sm:[&_button[data-slot=button]]:min-h-11 max-sm:[&_input]:min-h-11 max-sm:[&_button[data-size^=icon]]:min-w-11">
      <Tabs value={selectedTab} onValueChange={(value) => s.setPanel({ open: true, tab: value as PanelTab })} className="flex h-full min-h-0 flex-col gap-0">
        <header className="workbench-toolbar @container border-b bg-background/60 pr-2">
          <Heading className="sr-only">Workspace</Heading>
          <div className="h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList aria-label="Workspace tools" variant="line" className="workspace-tool-list justify-start gap-0 rounded-none p-0">
              {TABS.map((tab) => <TabsTrigger key={tab.id} value={tab.id} aria-label={tab.id === 'review' ? `Changes, ${changed} changed ${changed === 1 ? 'file' : 'files'}` : tab.label} className="h-10 flex-none gap-1.5 rounded-none border-0 px-3 text-[13px] font-normal group-data-[variant=line]/tabs-list:data-active:bg-muted/50 dark:group-data-[variant=line]/tabs-list:data-active:bg-muted/50 group-data-horizontal/tabs:after:bottom-0 after:h-px focus-visible:ring-inset max-sm:h-11 @max-[480px]:px-2 @max-[480px]:[&_svg]:hidden @max-[360px]:gap-1 @max-[360px]:px-1.5 [&_svg]:size-4">
                {tab.icon}<span>{tab.label}</span>{tab.id === 'review' && changed > 0 && <span aria-hidden="true" className="rounded bg-muted px-1 text-[11px] tabular-nums">{changed > 99 ? '99+' : changed}</span>}
              </TabsTrigger>)}
            </TabsList>
          </div>
          {s.workspaceExpanded ? <Button variant="ghost" size="xs" className="hidden shrink-0 gap-1.5 md:inline-flex" onClick={() => s.setWorkspaceExpanded(false)} aria-label="Restore split view"><Minimize2 className="size-4" />Show chat</Button> : <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action shrink-0 max-md:hidden [&_svg]:size-4" onClick={() => s.setWorkspaceExpanded(!s.workspaceExpanded)} aria-label={s.workspaceExpanded ? 'Restore split view' : 'Expand workspace'}>{s.workspaceExpanded ? <Minimize2 /> : <Maximize2 />}</Button></TooltipTrigger><TooltipContent>{s.workspaceExpanded ? 'Restore split view' : 'Expand workspace'}</TooltipContent></Tooltip>}
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action shrink-0 [&_svg]:size-4" onClick={() => s.setPanel({ ...s.panel, open: false })} aria-label="Close workspace"><X /></Button></TooltipTrigger><TooltipContent>Close workspace</TooltipContent></Tooltip>
        </header>
        <div className="min-h-0 flex-1">
          <TabsContent value="review" className="flex h-full min-h-0 flex-col"><div role="group" aria-label="Changes to show" className="flex shrink-0 gap-1 border-b p-2"><Button size="xs" variant={s.panel.tab === 'review' ? 'secondary' : 'ghost'} aria-pressed={s.panel.tab === 'review'} onClick={() => s.openPanel('review')}>Working tree</Button><Button size="xs" variant={s.panel.tab === 'changes' ? 'secondary' : 'ghost'} aria-pressed={s.panel.tab === 'changes'} onClick={() => s.openPanel('changes')}>Conversation activity</Button></div><div className="min-h-0 flex-1">{s.panel.tab === 'changes' ? <ChangesTab /> : <ReviewTab />}</div></TabsContent>
          <TabsContent value="files" forceMount className={s.panel.tab === 'files' ? 'h-full min-h-0' : 'hidden'}>
            {projects.map((project) => <div key={project} className={s.workdir === project ? 'h-full min-h-0' : 'hidden'}><FilesTab project={project} visible={s.workdir === project && s.panel.open && s.panel.tab === 'files' && !s.document} /></div>)}
          </TabsContent>
          <TabsContent value="memory" forceMount className={s.panel.tab === 'memory' ? 'h-full min-h-0' : 'hidden'}>{memoryOpened && s.project && <MemoryTab key={s.project} />}</TabsContent>
          <TabsContent value="preview" className="h-full min-h-0"><PreviewTab /></TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
