import * as React from 'react';
import { BookOpen, ChevronRight, Folder, GitBranch, Laptop, Plug, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { FileTypeIcon } from '@/components/file-type-icon';
import { AgentAvatar } from '@/components/agent-avatar';
import { useStore } from '@/store';

function ContextContents({ close, onNavigate = () => {} }: { close: () => void; onNavigate?: () => void }) {
  const s = useStore();
  const project = s.st?.projects.find((entry) => entry.path === s.project);
  const memory = s.thread?.messages.filter((message) => message.role === 'assistant').filter((message) => !!message.memoryContext).at(-1)?.memoryContext;
  const [servers, setServers] = React.useState<{ name: string; agent: string; enabled: boolean }[]>([]);
  const [loading, setLoading] = React.useState(true); const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let current = true; setLoading(true); setError(false); setServers([]);
    s.hub.call<typeof servers>('mcp', s.project).then((list) => { if (current) setServers(list); }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [s.hub, s.project]);
  const configured = servers.filter((server) => server.agent === s.agent.id && server.enabled);
  const leave = (action: () => void) => { onNavigate(); requestAnimationFrame(action); };
  return <>
    <header className="workbench-toolbar gap-2 px-3"><h2 className="flex-1 text-xs font-medium">Environment</h2><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Close project context" onClick={close}><X /></Button></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 text-[13px]">
      <div className="space-y-0.5 border-b pb-3">
        <p className="context-row"><Laptop /><span>This computer</span></p>
        <button className="context-row w-full hover:bg-muted" title={s.workdir || ''} onClick={() => leave(() => s.openPanel('files'))}><Folder /><span className="min-w-0 truncate">{project?.name || 'Project files'}</span><ChevronRight className="ml-auto" /></button>
        <p className="context-row" title={s.git?.root}><GitBranch /><span className="min-w-0 truncate">{s.git?.branch || (s.git ? 'No commits yet' : 'Not a Git project')}</span></p>
        <p className="context-row"><AgentAvatar agent={s.agent} size="xs" /><span className="min-w-0 truncate">{s.agent.name}</span><span className="ml-auto text-xs text-muted-foreground">{s.running ? 'Working' : 'Ready'}</span></p>
        <button className="context-row w-full hover:bg-muted" onClick={() => leave(() => s.setRoomOpen(true))}><Users /><span>Project room</span><ChevronRight className="ml-auto" /></button>
      </div>
      <details className="context-section group"><summary className="context-summary"><span>Context</span><ChevronRight className="size-3 group-open:rotate-90" /><span className="ml-auto text-xs text-muted-foreground">{memory ? `${memory.characters.toLocaleString()} chars` : 'Project memory'}</span></summary>
        {memory && <ul className="space-y-1 py-2 text-xs text-muted-foreground">{memory.sources.map((source) => <li key={`${source.source}:${source.line}`} className="truncate" title={source.source}>{source.source}:{source.line}</li>)}</ul>}
        <button className="context-row w-full hover:bg-muted" onClick={() => leave(() => s.openPanel('memory'))}><BookOpen /><span>View project memory</span></button>
      </details>
      <details className="context-section group"><summary className="context-summary"><span>Connectors</span><ChevronRight className="size-3 group-open:rotate-90" /><span className="ml-auto text-xs text-muted-foreground">{loading ? 'Loading…' : error ? 'Check setup' : `${configured.length} configured`}</span></summary>
        {configured.map((server) => <p key={server.name} className="context-row"><Plug /><span className="min-w-0 truncate">{server.name}</span></p>)}
        <button className="context-row w-full hover:bg-muted" onClick={() => leave(() => s.openSettings('mcp'))}><Plug /><span>Manage tools</span></button>
      </details>
      <section className="context-section" aria-label="Project changes"><div className="flex h-10 items-center justify-between"><h3 className="text-xs font-medium">Changes</h3><span className="text-xs tabular-nums text-muted-foreground">{s.git?.changed.length ?? 0}</span></div>
        {s.git?.changed.length ? <ul className="space-y-1">{s.git.changed.slice(0, 8).map((file) => <li key={file.path}><button className="context-row w-full hover:bg-muted" title={file.path} onClick={() => leave(() => s.openReview(file.path))}><FileTypeIcon path={file.path} /><span className="min-w-0 flex-1 truncate text-left">{file.path.split('/').pop()}</span><span className="shrink-0 font-mono text-xs text-muted-foreground">{file.code}</span></button></li>)}</ul> : <p className="py-2 text-xs text-muted-foreground">{s.git ? 'Working tree is clean.' : 'Git unavailable.'}</p>}
        {!!s.git?.changed.length && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-xs" onClick={() => leave(() => s.openPanel('review'))}>View all changes</Button>}
      </section>
    </div>
  </>;
}

export function ProjectContext() {
  const s = useStore();
  const [wide, setWide] = React.useState(() => window.innerWidth >= 1200);
  React.useEffect(() => { const media = window.matchMedia('(min-width: 1200px)'); const update = () => setWide(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const trigger = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => { if (s.contextSheetOpen) trigger.current = document.querySelector('button[aria-label="Project context"]'); }, [s.contextSheetOpen]);
  return <>
    {wide && s.contextOpen && <aside aria-label="Project context" className="flex w-80 shrink-0 flex-col border-l bg-background"><ContextContents close={() => s.setContextOpen(false)} /></aside>}
    <Sheet open={s.contextSheetOpen} onOpenChange={s.setContextSheetOpen}><SheetContent showCloseButton={false} className="w-[min(320px,100vw)]! gap-0" onCloseAutoFocus={(event) => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}><SheetTitle className="sr-only">Project context</SheetTitle><SheetDescription className="sr-only">Environment, memory, connectors and changes.</SheetDescription><ContextContents close={() => s.setContextSheetOpen(false)} onNavigate={() => s.setContextSheetOpen(false)} /></SheetContent></Sheet>
  </>;
}
