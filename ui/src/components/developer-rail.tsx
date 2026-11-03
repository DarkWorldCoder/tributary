import * as React from 'react';
import { BookOpen, Files, GitCompareArrows, Globe, PanelLeft, Search, Settings, SquarePen, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { useStore, type PanelTab } from '@/store';
import { NotificationsBell } from '@/components/notifications';

export function DeveloperEntry() {
  const s = useStore(); const { setOpen } = useSidebar();
  const entered = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!s.codeLayout || !s.thread || s.document || entered.current === s.thread.id) return;
    entered.current = s.thread.id; setOpen(false);
    if (window.innerWidth >= 768) { s.setWorkspaceExpanded(false); s.openPanel('files'); }
  }, [s.codeLayout, s.thread?.id, s.document, setOpen, s.openPanel, s.setWorkspaceExpanded]);
  return null;
}

export function DeveloperRail() {
  const s = useStore(); const { toggleSidebar, open } = useSidebar();
  const tool = (label: string, icon: React.ReactNode, action: () => void, active?: boolean) => <Tooltip key={label}><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="activity-button relative size-9 rounded-md text-muted-foreground aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground hover:text-foreground [&_svg]:size-4" aria-label={label} aria-pressed={active} onClick={action}>{icon}</Button></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>;
  const panel = (tab: PanelTab) => { s.setWorkspaceExpanded(false); s.openPanel(tab); };
  return <nav aria-label="Project tools" className="activity-rail flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1.5 max-md:hidden">
    <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" className="mb-2 size-9" aria-label="Projects and chats" aria-expanded={open} onClick={toggleSidebar}><img src="./logo.svg" className="size-6 rounded-md" alt="" /></Button></TooltipTrigger><TooltipContent side="right">Projects and chats</TooltipContent></Tooltip>
    {tool('New chat', <SquarePen />, () => s.newThread())}
    {tool('Search chats', <Search />, () => s.setPalette(true))}
    <div className="my-1 w-5 border-t" />
    {tool('Files', <Files />, () => panel('files'), s.panel.open && s.panel.tab === 'files')}
    {tool('Changes', <GitCompareArrows />, () => panel('review'), s.panel.open && ['review','changes'].includes(s.panel.tab))}
    {tool('Memory', <BookOpen />, () => panel('memory'), s.panel.open && s.panel.tab === 'memory')}
    {tool('Preview', <Globe />, () => panel('preview'), s.panel.open && s.panel.tab === 'preview')}
    {tool('Terminal', <SquareTerminal />, () => s.setTerminalOpen(!s.terminalOpen), s.terminalOpen)}
    <div className="flex-1" />
    <NotificationsBell />
    {tool('Toggle project list', <PanelLeft />, toggleSidebar, open)}
    {tool('Settings', <Settings />, () => s.openSettings('appearance'))}
  </nav>;
}
