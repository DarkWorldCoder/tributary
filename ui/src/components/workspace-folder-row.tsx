import { ChevronRight, Copy, Ellipsis, FolderMinus, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FolderTypeIcon } from '@/components/folder-type-icon';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useStore } from '@/store';
import type { HubState } from '@/types';
import { cn } from '@/lib/utils';

export function WorkspaceFolderRow({ folder, owner, expanded, onToggle, onRemoved }: { folder: string; owner: string; expanded: boolean; onToggle: () => void; onRemoved: (folder: string, restore: () => Promise<void>) => void }) {
  const s = useStore(); const [busy, setBusy] = React.useState(false);
  const name = folder.split(/[\\/]/).filter(Boolean).at(-1) || folder;
  const additional = folder !== owner && !!s.st?.projects.find((project) => project.path === owner)?.folders?.includes(folder);
  const update = async (restore: boolean) => {
    const state = await s.hub.call<HubState>('state');
    const project = state.projects.find((entry) => entry.path === owner);
    if (!project) throw new Error('The workspace is no longer available.');
    const folders = project.folders || [];
    await s.hub.call('setProjectFolders', owner, restore ? [...new Set([...folders, folder])] : folders.filter((path) => path !== folder));
    await s.refreshState();
  };
  const remove = async () => {
    if (busy) return; setBusy(true);
    try {
      await update(false);
      onRemoved(folder, () => update(true));
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const copy = () => { void navigator.clipboard.writeText(folder).then(() => toast.success('Folder path copied'), () => toast.error('Could not copy path')); };
  const close = () => s.setPanel({ ...s.panel, open: false });
  return <ContextMenu><ContextMenuTrigger asChild><div className="group/folder flex min-w-0 items-center">
    <button className="flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11" aria-expanded={expanded} title={folder} onClick={onToggle}><ChevronRight className={cn('size-3 shrink-0', expanded && 'rotate-90')} /><FolderTypeIcon path={folder} /><span className="truncate">{name}</span></button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={`Folder actions for ${folder}`} className="shrink-0 opacity-0 group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 max-sm:opacity-100" disabled={busy}><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={copy}><Copy />Copy folder path</DropdownMenuItem>{additional ? <DropdownMenuItem disabled={busy} onSelect={() => void remove()}><FolderMinus />Remove folder from workspace</DropdownMenuItem> : <DropdownMenuItem onSelect={close}><X />Close workspace</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
  </div></ContextMenuTrigger><ContextMenuContent aria-label={`Workspace folder ${name}`}><ContextMenuItem onSelect={copy}><Copy />Copy folder path</ContextMenuItem>{additional ? <ContextMenuItem disabled={busy} onSelect={() => void remove()}><FolderMinus />Remove folder from workspace</ContextMenuItem> : <ContextMenuItem onSelect={close}><X />Close workspace</ContextMenuItem>}</ContextMenuContent></ContextMenu>;
}
