import { WorkbenchLayoutMenu } from '@/components/workbench-layout-menu';
import * as React from 'react';
import { ArrowLeft, Crosshair, BookOpen, FolderOpen, Keyboard, Code2, Download, MessageSquare, MoreHorizontal, PanelRight, Pencil, Search, Users, Workflow, Activity, SquareTerminal, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { NotificationsBell } from '@/components/notifications';
import { SeparateCopy } from '@/components/separate-copy';
import { useStore } from '@/store';
import { ChevronDown, FileText } from 'lucide-react';
import { ProjectMenu } from '@/components/project-menu';
import { ChatSwitcher } from '@/components/chat-switcher';

export function ThreadHeader({ compact = false }: { compact?: boolean }) {
  const s = useStore(); const t = s.thread;
  const { setOpen: setSidebarOpen } = useSidebar();
  const conversationView = s.workspaceLayout === 'chat' && !!t?.messages.length && !s.home && !t.task;
  const switchView = () => {
    if (s.workspaceLayout === 'editor') { s.setWorkspaceLayout('chat'); s.setPanel({ ...s.panel, open: false }); setSidebarOpen(true); }
    else { s.setWorkspaceLayout('editor'); s.setWorkspaceExpanded(false); s.openPanel('files'); setSidebarOpen(false); }
  };
  const [rename, setRename] = React.useState(false); const [title, setTitle] = React.useState('');
  const [del, setDel] = React.useState(false);
  const [editors, setEditors] = React.useState<{ id: string; name: string }[]>([]);
  const project = s.st?.projects.find((p) => p.path === s.project);
  const agentsHere = t ? [...new Set(t.messages.filter((m) => m.role === 'assistant' && m.agent !== 'race').map((m) => (m.role === 'assistant' ? m.agent : '')))] : [];
  const cost = t ? t.messages.reduce((n, m) => n + (m.role === 'assistant' && m.costUsd ? m.costUsd : 0), 0) : 0;
  const team = t && s.st?.teams?.[t.id];
  React.useEffect(() => { if (s.hub.platform === 'desktop') s.hub.call<{ id: string; name: string }[]>('editors').then(setEditors).catch(() => {}); }, [s.hub]);

  const share = async () => { try { const c = await s.hub.call<string[]>('syncInstructions', s.project); toast.success(c.length ? `Created ${c.join(', ')}` : 'Agent instructions already shared'); s.refreshGit(); } catch (error) { toast.error((error as Error).message); } };
  const exportThread = async () => {
    if (!t) return;
    if (s.hub.platform === 'desktop') { const f = await s.hub.call<string | null>('exportThread', t.id); if (f) toast.success(`Exported to ${f}`); }
    else toast.message('Export is available in the desktop app.');
  };
  return (
    <header className={compact || conversationView ? "chat-toolbar workbench-toolbar gap-1 border-b px-2 [&_svg]:size-4" : "flex h-12 shrink-0 items-center gap-1.5 px-3"}>
      <SidebarTrigger className={compact ? "-ml-1 md:hidden" : "-ml-1"} />{compact && <AgentAvatar agent={s.agent} size="xs" />}
      {t?.delegation && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Back to parent chat" onClick={() => s.openThread(t.delegation!.parentThreadId)}><ArrowLeft /></Button></TooltipTrigger><TooltipContent>Parent chat</TooltipContent></Tooltip>}
      <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0">
        <h1 className={compact || conversationView ? "max-w-full text-[13px] font-medium" : "max-w-full text-[0.9375rem] font-semibold"}>{s.project && !s.home ? <ChatSwitcher title={t?.title || 'New chat'} /> : s.home ? 'Start a task' : 'Tributary'}</h1>
        {project && !compact && !conversationView && (
          <ProjectMenu><button className="flex max-w-full items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" title={project.path} aria-label={`Project options: ${project.name}`}>
            <span className="truncate">{project.name}{project.folders?.length ? ` +${project.folders.length}` : ''}{s.git?.branch ? ` on ${s.git.branch}` : ''}</span><ChevronDown className="size-3 shrink-0" />
          </button></ProjectMenu>
        )}
      </div>
      {t && <span className="hidden sm:contents"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Follow agent" aria-pressed={s.following} disabled={s.agent.capabilities?.tools === false} onClick={s.toggleFollowing}><Crosshair className={s.following ? 'text-brand' : ''} /></Button></TooltipTrigger><TooltipContent>{s.following ? 'Following agent · click to pause' : s.agent.capabilities?.tools === false ? 'Agent has no live file activity' : 'Follow agent files'}</TooltipContent></Tooltip></span>}
      <span className="hidden sm:contents"><WorkbenchLayoutMenu /><SeparateCopy /></span>
      {compact && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="max-md:hidden" aria-label="Hide chat" onClick={() => { if (!s.panel.open) s.openPanel('files'); s.setWorkspaceExpanded(true); }}><X className="size-4" /></Button></TooltipTrigger><TooltipContent>Hide chat</TooltipContent></Tooltip>}
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action relative" aria-label="Open live activity" onClick={() => window.dispatchEvent(new Event('tributary:live'))}><Activity />{!!s.st?.running.length && <span aria-label={`${s.st.running.length} chats working`} className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" />}</Button></TooltipTrigger><TooltipContent>Live activity</TooltipContent></Tooltip>
      {!compact && team && <span className="hidden items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs text-brand sm:inline-flex">{s.st?.recipes?.[team.recipe]?.name ?? 'Team'}: step {team.steps.length}</span>}
      {!compact && !conversationView && agentsHere.length > 0 && (
        <Tooltip><TooltipTrigger asChild>
          <span className="hidden items-center -space-x-1 sm:flex">{agentsHere.map((id) => <AgentAvatar key={id} agent={s.agentOf(id)} size="sm" className="ring-2 ring-background" />)}</span>
        </TooltipTrigger><TooltipContent>{agentsHere.map((id) => s.agentOf(id).name).join(', ')} worked in this thread{cost ? `. Cost so far $${cost.toFixed(2)}` : ''}</TooltipContent></Tooltip>
      )}
      {!compact && <NotificationsBell />}
      {compact && <div className="md:hidden"><NotificationsBell /></div>}

      {s.project && (
        <>
          {!compact && !!t?.messages.length && !s.home && !t.task && <span className="hidden sm:contents"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={s.workspaceLayout === 'editor' ? 'Switch to chat view' : 'Switch to workbench'} onClick={switchView}>{s.workspaceLayout === 'editor' ? <MessageSquare /> : <Code2 />}</Button></TooltipTrigger><TooltipContent>{s.workspaceLayout === 'editor' ? 'Chat view' : 'Workbench'}</TooltipContent></Tooltip></span>}
          {conversationView && <span className="hidden sm:contents"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Project context" aria-pressed={s.contextOpen} onClick={() => window.innerWidth < 1200 ? s.setContextSheetOpen(true) : s.setContextOpen(!s.contextOpen)}><PanelRight /></Button></TooltipTrigger><TooltipContent>Project context</TooltipContent></Tooltip></span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More options"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {compact && team && <DropdownMenuLabel>{s.st?.recipes?.[team.recipe]?.name ?? 'Team'} · step {team.steps.length}</DropdownMenuLabel>}
              <DropdownMenuItem onClick={() => { s.setWorkspaceExpanded(false); s.setPanel({ ...s.panel, open: !s.panel.open }); }}><PanelRight />{s.panel.open ? 'Hide workspace' : 'Open workspace'}</DropdownMenuItem>
              <DropdownMenuItem onClick={switchView}><MessageSquare />{s.workspaceLayout === 'editor' ? 'Chat view' : 'Workbench view'}</DropdownMenuItem>
              {t && <DropdownMenuItem className="sm:hidden" disabled={s.agent.capabilities?.tools === false} onClick={s.toggleFollowing}><Crosshair />{s.following ? 'Pause following agent' : 'Follow agent'}</DropdownMenuItem>}
              {conversationView && <DropdownMenuItem className="sm:hidden" onClick={() => s.setContextSheetOpen(true)}><PanelRight />Project context</DropdownMenuItem>}
              <div className="flex items-center justify-between px-2 sm:hidden"><span className="text-xs text-muted-foreground">Working copy</span><SeparateCopy /></div>
              <DropdownMenuItem onClick={() => s.setTerminalOpen(!s.terminalOpen)}><SquareTerminal />{s.terminalOpen ? 'Close terminal' : 'Open terminal'}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => s.setRoomOpen(true)}><Users />Project room</DropdownMenuItem>
              <DropdownMenuItem onClick={() => s.setTeamOpen(true)}><Workflow />Agent teams</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.dispatchEvent(new Event('tributary:live'))}><Activity />Live activity</DropdownMenuItem>
              <DropdownMenuItem onClick={() => s.setShortcutsOpen(true)}><Keyboard />Keyboard shortcuts</DropdownMenuItem>
              {t && <DropdownMenuItem onClick={() => { setTitle(t.title); setRename(true); }}><Pencil /> Rename chat</DropdownMenuItem>}
              {t && <DropdownMenuItem onClick={exportThread}><Download /> Export chat</DropdownMenuItem>}
              {editors.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><FolderOpen />Open project in…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuLabel>Installed editors</DropdownMenuLabel>
                    {editors.map((e) => <DropdownMenuItem key={e.id} onClick={() => s.hub.call('openInEditor', e.id, s.project)}>{e.name}</DropdownMenuItem>)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {!project?.kind && <DropdownMenuItem onClick={share}><BookOpen /> Share agent instructions</DropdownMenuItem>}
              {t?.documents?.map((d) => <DropdownMenuItem key={d.id} onClick={() => s.setDocument({ threadId: t.id, id: d.id })}><FileText />{d.title}</DropdownMenuItem>)}
              {t && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDel(true)}><Trash2 /> Delete chat</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rename chat</DialogTitle></DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('rename-save') as HTMLButtonElement)?.click(); }} aria-label="Chat name" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(false)}>Cancel</Button>
            <Button id="rename-save" disabled={!title.trim()} onClick={async () => { await s.hub.call('renameThread', t!.id, title.trim()); s.setThread({ ...t!, title: title.trim() }); s.loadThreads(t!.project); setRename(false); }}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete “{t?.title}”?</AlertDialogTitle><AlertDialogDescription>This removes the chat from Tributary. Each agent keeps its own session history{t?.worktree ? `, and your project folder does not change. Its separate copy is removed, and its work stays on branch ${t.worktree.branch}.` : ', and no files change.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { const p = t!.project; await s.hub.call('deleteThread', t!.id); await s.loadThreads(p); s.newThread(p); }}>Delete chat</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
