import * as React from 'react';
import { Check, ChevronRight, CircleAlert, Folder, FolderPlus, GitBranch, Home, MoreHorizontal, Search, Settings, ShieldQuestion, SquarePen, Trash2, Users } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarHeader, SidebarInput,
  SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar,
} from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { AgentAvatar } from '@/components/agent-avatar';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { ThreadStatus, ThreadSummary } from '@/types';

function ThreadDots({ t }: { t: ThreadSummary }) {
  const s = useStore();
  const ids = [...new Set((t.agents?.length ? t.agents : [t.lastAgent]).filter(Boolean).map((a) => String(a).split('@')[0]))].slice(0, 3);
  return <span className="flex -space-x-1">{ids.map((id) => <AgentAvatar key={id} agent={s.agentOf(id)} size="xs" className="ring-2 ring-sidebar" />)}</span>;
}

// Working, waiting for permission, needs review (finished with changes you have not opened), failed, done.
function StatusBadge({ status }: { status?: ThreadStatus | null }) {
  if (status === 'working') return <Spinner className="size-3.5 shrink-0 text-brand" aria-label="Working" />;
  if (status === 'permission') return <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand/15 px-1.5 text-[10px] leading-4 font-medium text-brand" title="Waiting for you to allow or deny a tool"><ShieldQuestion className="size-3" aria-hidden />Approve</span>;
  if (status === 'review') return <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] leading-4 font-medium text-warning" title="Finished with file changes you have not opened">Review</span>;
  if (status === 'failed') return <span role="img" aria-label="Failed" title="Failed" className="shrink-0 text-destructive"><CircleAlert className="size-3.5" aria-hidden /></span>;
  if (status === 'done') return <span role="img" aria-label="Done" title="Done" className="shrink-0 text-muted-foreground"><Check className="size-3.5" aria-hidden /></span>;
  return null;
}

function ThreadRow({ t }: { t: ThreadSummary }) {
  const s = useStore(); const { isMobile, setOpenMobile } = useSidebar();
  const active = s.thread?.id === t.id;
  const status = t.status ?? (t.running ? 'working' : null);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton isActive={active} onClick={() => { s.openThread(t.id); if (isMobile) setOpenMobile(false); }} className={cn('gap-2 pr-1.5', t.branch ? 'h-auto py-1' : 'h-8')} title={t.title}>
        {/* A thread in a separate working copy shows its branch under the title. */}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{t.title}</span>
          {t.branch && <span className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] leading-4 text-muted-foreground" title={`Works in a separate copy on branch ${t.branch}`}><GitBranch className="size-3 shrink-0" aria-hidden /><span className="truncate">{t.branch}</span></span>}
        </span>
        {status === 'working' || status === 'permission' ? <StatusBadge status={status} /> : <><StatusBadge status={status} /><ThreadDots t={t} /><span className="w-7 text-right text-[11px] tabular-nums text-muted-foreground">{ago(t.updatedAt)}</span></>}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

export function AppSidebar() {
  const s = useStore(); const [q, setQ] = React.useState(''); const [more, setMore] = React.useState<Record<string, boolean>>({});
  const { isMobile, setOpenMobile } = useSidebar();
  const vs = s.hub.platform === 'vscode';
  const projects = s.st?.projects ?? [];
  const query = q.trim().toLowerCase();
  const results = query ? projects.flatMap((p) => (s.threadsBy[p.path] || []).filter((t) => t.title.toLowerCase().includes(query)).map((t) => ({ ...t, project: p.name }))) : [];
  const ready = s.ready;
  const addProject = async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } };
  const newThread = (p?: string) => { s.newThread(p); if (isMobile) setOpenMobile(false); };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-1.5 pb-0">
        <div className="flex items-center gap-2 px-1.5 pt-1 pb-1.5">
          <img src="./logo.svg" alt="" className="size-6 rounded-[7px]" />
          <span className="flex-1 text-[15px] font-semibold tracking-tight">Tributary</span>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" onClick={() => s.setPalette(true)} aria-label="Search and commands" title="Search and commands (Ctrl+K)"><Search className="size-4" /></button>
        </div>
        <SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton onClick={s.goHome} isActive={s.home || !s.project}><Home /><span>Start a task</span></SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton onClick={() => s.setRoomOpen(true)}><Users /><span>Project room</span></SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => newThread()} disabled={!s.project} className="font-medium">
              <SquarePen /> <span>New conversation</span> <Kbd className="ml-auto">Ctrl N</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads…" aria-label="Search threads" className="mt-1" />
      </SidebarHeader>

      <SidebarContent>
        {query ? (
          <SidebarGroup>
            <SidebarGroupLabel>{results.length ? `${results.length} result${results.length > 1 ? 's' : ''}` : 'No threads match'}</SidebarGroupLabel>
            <SidebarMenu><SidebarMenuSub className="mx-0 border-0 px-0">{results.map((t) => <ThreadRow key={t.id} t={t} />)}</SidebarMenuSub></SidebarMenu>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>My work</SidebarGroupLabel>
            {!vs && <SidebarGroupAction onClick={addProject} title="Add project folder" aria-label="Add project folder"><FolderPlus /></SidebarGroupAction>}
            <SidebarMenu>
              {projects.map((p) => {
                const ts = s.threadsBy[p.path] || []; const all = more[p.path]; const shown = all ? ts : ts.slice(0, 8);
                return (
                  <Collapsible key={p.path} asChild defaultOpen={p.path === s.project} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={p.path} isActive={p.path === s.project && !s.thread} className="font-medium">
                          <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          <Folder className="text-muted-foreground" /><span className="truncate">{p.name}</span>
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><SidebarMenuAction showOnHover aria-label={`${p.name} options`}><MoreHorizontal /></SidebarMenuAction></DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-52">
                          <DropdownMenuItem onClick={() => newThread(p.path)}><SquarePen /> New thread here</DropdownMenuItem>
                          {!vs && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={async () => { await s.hub.call('removeProject', p.path); await s.refreshState(); if (s.project === p.path) s.newThread(projects.find((x) => x.path !== p.path)?.path ?? null); }}><Trash2 /> Remove from Tributary</DropdownMenuItem></>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mr-0 pr-0">
                          {shown.map((t) => <ThreadRow key={t.id} t={t} />)}
                          {!ts.length && <li className="px-2 py-1 text-xs text-muted-foreground">No threads yet</li>}
                          {ts.length > 8 && (
                            <SidebarMenuSubItem><SidebarMenuSubButton className="text-muted-foreground" onClick={() => setMore((m) => ({ ...m, [p.path]: !all }))}>{all ? 'Show less' : `Show ${ts.length - 8} more`}</SidebarMenuSubButton></SidebarMenuSubItem>
                          )}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
              {!projects.length && <li className="px-2 py-1 text-sm text-muted-foreground">No projects yet.</li>}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => s.openSettings('appearance')} className="h-9">
              <Settings className="text-muted-foreground" /><span>Settings</span>
              <span className="ml-auto text-xs text-muted-foreground">{s.st?.scanningAgents && !ready.length ? 'Finding agents…' : `${ready.length} ready`}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
