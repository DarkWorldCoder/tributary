import { ShortcutLabel } from '@/components/shortcut-settings';
import type { ShortcutAction } from '../../../core/shortcuts.mjs';
import * as React from 'react';
import { Bug, BookOpen, Files, GitCompareArrows, Globe, PanelLeft, Search, Settings, SquarePen, SquareTerminal, Users, Workflow, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { useStore, type PanelTab } from '@/store';
import { NotificationsBell } from '@/components/notifications';

export function DeveloperEntry() {
  const s = useStore(); const { setOpen } = useSidebar();
  const entered = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!s.codeLayout || !s.thread || s.document || !s.project || entered.current.has(s.project)) return;
    entered.current.add(s.project);
    // Enter each project's workbench once; a new turn must not reset a chosen tool or layout.
    if (window.innerWidth >= 768 && !s.workspaceViewSaved && !s.panel.open) { setOpen(false); s.openPanel('files'); }
  }, [s.codeLayout, s.thread?.id, s.project, s.document, s.panel.open, setOpen, s.openPanel, s.setWorkspaceExpanded]);
  return null;
}

export function DeveloperRail({ workspaceVisible }: { workspaceVisible: boolean }) {
  const s = useStore(); const { toggleSidebar, open } = useSidebar();
  const hints: Record<string, ShortcutAction> = { 'New chat': 'new', 'Search in files': 'search-project', 'Search chats': 'search', 'Project room': 'room', 'Agent teams': 'team', 'Live activity': 'activity', Files: 'files', Changes: 'changes', Memory: 'memory', Preview: 'preview', Debugger: 'debug', Terminal: 'terminal', Settings: 'settings', 'Toggle project list': 'sidebar' };
  const tool = (label: string, icon: React.ReactNode, action: () => void, active?: boolean) => <Tooltip key={label}><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="activity-button relative size-9 rounded-md text-muted-foreground aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground hover:text-foreground [&_svg]:size-4" aria-label={label} aria-pressed={active} onClick={action}>{icon}</Button></TooltipTrigger><TooltipContent side="right">{label}{hints[label] && <> <ShortcutLabel action={hints[label]} /></>}</TooltipContent></Tooltip>;
  const panel = (tab: PanelTab) => { if (tab === 'files') s.setSearchFilesOpen(false); s.setWorkspaceExpanded(false); s.openPanel(tab); };
  return <nav inert={workspaceVisible && s.workspaceExpanded} aria-label="Project tools" className="activity-rail flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1.5 max-md:hidden">
    <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className="mb-2 size-9" aria-label="Projects and chats" aria-expanded={open} onClick={toggleSidebar}><img src="./logo.svg" className="size-6 rounded-md" alt="" /></Button></TooltipTrigger><TooltipContent side="right">Projects and chats <ShortcutLabel action="sidebar" /></TooltipContent></Tooltip>
    {tool('New chat', <SquarePen />, () => s.newThread())}
    {tool('Search in files', <Search />, () => window.dispatchEvent(new Event('tributary:search-project')), s.searchFilesOpen && workspaceVisible && s.panel.tab === 'files')}
    {!open && tool('Project room', <Users />, () => s.setRoomOpen(true), s.roomOpen)}
    {tool('Agent teams', <Workflow />, () => s.setTeamOpen(true), s.teamOpen)}
    {tool('Live activity', <Activity />, () => window.dispatchEvent(new Event('tributary:live')))}
    <div className="my-1 w-5 border-t" />
    {!workspaceVisible && <>
      {tool('Files', <Files />, () => panel('files'))}
      {tool('Changes', <GitCompareArrows />, () => panel('review'))}
      {tool('Memory', <BookOpen />, () => panel('memory'))}
      {tool('Preview', <Globe />, () => panel('preview'))}
    </>}
    {tool('Debugger', <Bug />, () => s.setDebugOpen(!s.debugOpen), s.debugOpen)}
    {tool('Terminal', <SquareTerminal />, () => s.setTerminalOpen(!s.terminalOpen), s.terminalOpen)}
    <div className="flex-1" />
    <NotificationsBell />
    {tool('Toggle project list', <PanelLeft />, toggleSidebar, open)}
    {tool('Settings', <Settings />, () => s.openSettings('appearance'))}
  </nav>;
}
