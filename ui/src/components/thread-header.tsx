import * as React from 'react';
import { BookOpen, Download, FolderPlus, FolderTree, MoreHorizontal, PanelRight, Pencil, SquareTerminal, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { NotificationsBell } from '@/components/notifications';
import { SeparateCopy } from '@/components/separate-copy';
import { useStore } from '@/store';
import { FileText } from 'lucide-react';

/** Extra folders the agents may read and edit alongside the project. */
function FoldersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const s = useStore(); const project = s.st?.projects.find((p) => p.path === s.project);
  const folders = project?.folders ?? [];
  const save = async (next: string[]) => { try { await s.hub.call('setProjectFolders', s.project, next); await s.refreshState(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Folders in this project</DialogTitle>
          <DialogDescription>Add other folders the agents may read and change, such as a shared library or a backend next to this frontend. Each agent gets them through its own add-folder option.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1.5">
          <li className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><FolderTree className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{s.project}</span><span className="text-xs text-muted-foreground">Main</span></li>
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><FolderTree className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs" title={f}>{f}</span>
              <Button size="icon-xs" variant="ghost" aria-label={`Remove ${f}`} onClick={() => save(folders.filter((x) => x !== f))}><X /></Button></li>
          ))}
        </ul>
        <DialogFooter>
          {s.hub.platform === 'desktop' && <Button variant="outline" onClick={async () => { const f = await s.hub.call<string | null>('pickFolder'); if (f) save([...folders, f]); }}><FolderPlus /> Add a folder</Button>}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ThreadHeader() {
  const s = useStore(); const t = s.thread;
  const [rename, setRename] = React.useState(false); const [title, setTitle] = React.useState('');
  const [del, setDel] = React.useState(false); const [folders, setFolders] = React.useState(false);
  const [editors, setEditors] = React.useState<{ id: string; name: string }[]>([]);
  const project = s.st?.projects.find((p) => p.path === s.project);
  const agentsHere = t ? [...new Set(t.messages.filter((m) => m.role === 'assistant' && m.agent !== 'race').map((m) => (m.role === 'assistant' ? m.agent : '')))] : [];
  const cost = t ? t.messages.reduce((n, m) => n + (m.role === 'assistant' && m.costUsd ? m.costUsd : 0), 0) : 0;
  const team = t && s.st?.teams?.[t.id];
  React.useEffect(() => { if (s.hub.platform === 'desktop') s.hub.call<{ id: string; name: string }[]>('editors').then(setEditors).catch(() => {}); }, [s.hub]);

  const share = async () => { const c = await s.hub.call<string[]>('syncInstructions', s.project); toast.success(c.length ? `Created ${c.join(', ')}. Every agent now reads AGENTS.md.` : 'AGENTS.md is already shared with every agent.'); s.refreshGit(); };
  const exportThread = async () => {
    if (!t) return;
    if (s.hub.platform === 'desktop') { const f = await s.hub.call<string | null>('exportThread', t.id); if (f) toast.success(`Exported to ${f}`); }
    else toast.message('Export is available in the desktop app.');
  };
  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate text-[0.9375rem] font-semibold">{s.home ? 'Start a task' : t ? t.title : project ? 'New conversation' : 'Tributary'}</h1>
        {project && (
          <button className="truncate text-sm text-muted-foreground hover:text-foreground" title={`${project.path}${project.folders?.length ? ` and ${project.folders.length} more folder${project.folders.length > 1 ? 's' : ''}` : ''}`} onClick={() => setFolders(true)}>
            {project.name}{project.folders?.length ? ` +${project.folders.length}` : ''}{s.git?.branch ? ` on ${s.git.branch}` : ''}
          </button>
        )}
      </div>
      <SeparateCopy />
      {team && <span className="hidden items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs text-brand sm:inline-flex">{s.st?.recipes?.[team.recipe]?.name ?? 'Team'}: step {team.steps.length}</span>}
      {agentsHere.length > 0 && (
        <Tooltip><TooltipTrigger asChild>
          <span className="hidden items-center -space-x-1 sm:flex">{agentsHere.map((id) => <AgentAvatar key={id} agent={s.agentOf(id)} size="sm" className="ring-2 ring-background" />)}</span>
        </TooltipTrigger><TooltipContent>{agentsHere.map((id) => s.agentOf(id).name).join(', ')} worked in this thread{cost ? `. Cost so far $${cost.toFixed(2)}` : ''}</TooltipContent></Tooltip>
      )}
      <NotificationsBell />
      {s.project && (
        <>
          <Tooltip><TooltipTrigger asChild>
            <Button variant={s.terminalOpen ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={s.terminalOpen} aria-label="Terminal" onClick={() => s.setTerminalOpen(!s.terminalOpen)}><SquareTerminal /></Button>
          </TooltipTrigger><TooltipContent>Terminal (Ctrl+`)</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant={s.panel.open ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={s.panel.open} aria-label="Workspace: review, files, memory, preview" onClick={() => s.setPanel({ ...s.panel, open: !s.panel.open })}>
              <PanelRight />{(s.git?.changed.length ?? 0) > 0 && !s.panel.open && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" />}
            </Button>
          </TooltipTrigger><TooltipContent>Workspace: review, files, memory, preview (Ctrl+J)</TooltipContent></Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More options"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {t && <DropdownMenuItem onClick={() => { setTitle(t.title); setRename(true); }}><Pencil /> Rename thread</DropdownMenuItem>}
              {t && <DropdownMenuItem onClick={exportThread}><Download /> Export thread as Markdown</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => setFolders(true)}><FolderTree /> Folders in this project…</DropdownMenuItem>
              {editors.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Open project in…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuLabel>Installed editors</DropdownMenuLabel>
                    {editors.map((e) => <DropdownMenuItem key={e.id} onClick={() => s.hub.call('openInEditor', e.id, s.project)}>{e.name}</DropdownMenuItem>)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {!project?.kind && <DropdownMenuItem onClick={share}><BookOpen /> Share AGENTS.md with every agent</DropdownMenuItem>}
              {t?.documents?.map((d) => <DropdownMenuItem key={d.id} onClick={() => s.setDocument({ threadId: t.id, id: d.id })}><FileText />{d.title}</DropdownMenuItem>)}
              {t && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDel(true)}><Trash2 /> Delete thread</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <FoldersDialog open={folders} onOpenChange={setFolders} />
      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rename thread</DialogTitle></DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('rename-save') as HTMLButtonElement)?.click(); }} aria-label="Thread name" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(false)}>Cancel</Button>
            <Button id="rename-save" disabled={!title.trim()} onClick={async () => { await s.hub.call('renameThread', t!.id, title.trim()); s.setThread({ ...t!, title: title.trim() }); s.loadThreads(t!.project); setRename(false); }}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete “{t?.title}”?</AlertDialogTitle><AlertDialogDescription>This removes the thread from Tributary. Each agent keeps its own session history{t?.worktree ? `, and your project folder does not change. Its separate copy is removed, and its work stays on branch ${t.worktree.branch}.` : ', and no files change.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { const p = t!.project; await s.hub.call('deleteThread', t!.id); await s.loadThreads(p); s.newThread(p); }}>Delete thread</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
