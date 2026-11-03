import { Columns2, MessageSquare, PanelLeft, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store';
export function WorkbenchLayoutMenu() {
  const s = useStore(); const selected = !s.panel.open ? 'chat-only' : s.workspaceLayout;
  return <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action shrink-0" aria-label="Workspace layout"><Columns2 /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Workspace layout</TooltipContent></Tooltip>
    <DropdownMenuContent align="end"><DropdownMenuLabel>Workspace layout</DropdownMenuLabel><DropdownMenuRadioGroup value={selected} onValueChange={(value) => {
      s.pauseFollowing(); s.setWorkspaceExpanded(false);
      if (value === 'chat-only') { s.setWorkspaceLayout('chat'); s.setPanel({ ...s.panel, open: false }); }
      else { s.setWorkspaceLayout(value as 'editor' | 'chat'); s.setPanel({ ...s.panel, open: true }); }
    }}><DropdownMenuRadioItem value="editor"><PanelLeft className="size-4" />Editor first</DropdownMenuRadioItem><DropdownMenuRadioItem value="chat"><PanelRight className="size-4" />Chat first</DropdownMenuRadioItem><DropdownMenuRadioItem value="chat-only"><MessageSquare className="size-4" />Chat only</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>;
}
