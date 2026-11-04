import { Columns2, Maximize, Minimize, MessageSquare, PanelLeft, PanelRight, Scan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { ShortcutLabel } from '@/components/shortcut-settings';
export function WorkbenchLayoutMenu() {
  const s = useStore(); const fullscreen = useFullscreen();
  const selected = !s.panel.open ? 'chat-only' : s.workspaceExpanded ? 'workspace-only' : s.workspaceLayout;
  return <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action shrink-0" aria-label="Workspace layout"><Columns2 /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Workspace layout</TooltipContent></Tooltip>
    <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-16px)] [&_[role^=menuitem]]:text-[13px]"><DropdownMenuLabel>Workspace layout</DropdownMenuLabel><DropdownMenuRadioGroup value={selected} onValueChange={(value) => {
      s.pauseFollowing(); s.setWorkspaceExpanded(value === 'workspace-only');
      if (value === 'chat-only') { s.setWorkspaceLayout('chat'); s.setPanel({ ...s.panel, open: false }); }
      else { if (value !== 'workspace-only') s.setWorkspaceLayout(value as 'editor' | 'chat'); s.setPanel({ ...s.panel, open: true }); }
    }}><DropdownMenuRadioItem value="editor"><PanelLeft className="size-4" />Editor first</DropdownMenuRadioItem><DropdownMenuRadioItem value="chat"><PanelRight className="size-4" />Chat first</DropdownMenuRadioItem><DropdownMenuRadioItem value="chat-only"><MessageSquare className="size-4" />Chat only</DropdownMenuRadioItem><DropdownMenuRadioItem value="workspace-only"><Scan className="size-4" />Focus workspace<ShortcutLabel action="zoom-workspace" /></DropdownMenuRadioItem></DropdownMenuRadioGroup>
    {fullscreen.supported && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void fullscreen.toggle()}>{fullscreen.active ? <Minimize /> : <Maximize />}{fullscreen.active ? 'Exit full screen' : 'Full screen'}<ShortcutLabel action="fullscreen" /></DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
