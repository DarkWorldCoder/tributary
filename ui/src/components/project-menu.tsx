import * as React from 'react';
import { Check, Copy, FolderInput, FolderPlus, FolderTree, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store';
import type { HubState } from '@/types';

/** The same project actions wherever the project name appears. Paths remain the project identity. */
export function ProjectMenu({ children, projectPath, before, after, side = 'bottom', align = 'start' }: {
  children: React.ReactNode; projectPath?: string | null; before?: React.ReactNode; after?: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end';
}) {
  const s = useStore(); const path = projectPath ?? s.project;
  const project = s.st?.projects.find((entry) => entry.path === path);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const intent = React.useRef(false);
  const [target, setTarget] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'rename' | 'folders' | null>(null);
  const lastDialog = React.useRef<'rename' | 'folders'>('rename'); if (dialog) lastDialog.current = dialog;
  const contents = dialog ?? lastDialog.current;
  const [name, setName] = React.useState(''); const [folder, setFolder] = React.useState('');
  const [pathEntry, setPathEntry] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const selected = s.st?.projects.find((entry) => entry.path === target);
  const folders = selected?.folders ?? [];
  const native = s.hub.platform === 'desktop' || s.hub.platform === 'vscode';
  const open = (next: 'rename' | 'folders') => {
    if (!project) return;
    intent.current = true; setTarget(project.path); setName(project.name); setFolder(''); setError(''); setPathEntry(!native); setDialog(next);
  };
  const saveFolders = async (root: string, next: string[]) => {
    await s.hub.call('setProjectFolders', root, next); await s.refreshState();
  };
  const appendFolder = async (root: string, value: string | string[]) => {
    const state = await s.hub.call<HubState>('state');
    const current = state.projects.find((entry) => entry.path === root);
    if (!current) throw new Error('This project is no longer available.');
    await saveFolders(root, [...(current.folders ?? []), ...(Array.isArray(value) ? value : [value])]);
  };
  const pickFolder = async (root: string) => {
    setBusy(true); setError('');
    try { const values = await s.hub.call<string[]>('pickFolders'); if (values.length) { await appendFolder(root, values); toast.success(`${values.length} folder${values.length === 1 ? '' : 's'} added`); } }
    catch (e) { setError((e as Error).message); toast.error('Could not add folder'); }
    finally { setBusy(false); }
  };
  if (!project) return <>{children}</>;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild ref={trigger}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-60 max-w-[calc(100vw-16px)] max-sm:[&_[role^=menuitem]]:min-h-11" onCloseAutoFocus={(event) => { if (intent.current) { event.preventDefault(); intent.current = false; } }}>
        <DropdownMenuLabel className="truncate" title={project.path}>{project.name}</DropdownMenuLabel>
        {before}
        <DropdownMenuItem onSelect={() => open('rename')}><Pencil />Rename project</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => { open('folders'); if (native) void pickFolder(project.path); }}><FolderPlus />Add folders to workspace…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open('folders')}><FolderTree />Manage folders</DropdownMenuItem>
        {native && <DropdownMenuItem onSelect={() => { void s.hub.call('saveWorkspace', project.path).then((file) => { if (file) toast.success('Workspace saved'); }, (error) => toast.error(error.message)); }}><Save />Save workspace as…</DropdownMenuItem>}
        {native && <DropdownMenuItem onSelect={() => { void s.hub.call<string | null>('openWorkspace').then(async (root) => { if (root) { await s.refreshState(); s.newThread(root); } }, (error) => toast.error(error.message)); }}><FolderInput />Open workspace…</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(project.path).then(() => toast.success('Project path copied'), () => toast.error('Could not copy project path'))}><Copy />Copy project path</DropdownMenuItem>
        {(s.st?.projects.length ?? 0) > 1 && <><DropdownMenuSeparator /><DropdownMenuSub><DropdownMenuSubTrigger><FolderInput />Switch project</DropdownMenuSubTrigger><DropdownMenuSubContent className="max-h-72 max-w-72 overflow-auto">{s.st?.projects.map((entry) => <DropdownMenuItem key={entry.path} title={entry.path} onSelect={() => s.newThread(entry.path)}><Check className={entry.path === s.project ? '' : 'invisible'} /><span className="truncate">{entry.name}</span></DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub></>}
        {after}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={!!dialog} onOpenChange={(value) => { if (!value) { setDialog(null); setError(''); } }}>
      <DialogContent className="max-sm:[&_button]:min-h-11 max-sm:[&_input]:min-h-11" onCloseAutoFocus={(event) => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
        <DialogHeader><DialogTitle>{contents === 'rename' ? 'Rename project' : 'Workspace folders'}</DialogTitle><DialogDescription className="sr-only">{contents === 'rename' ? 'Change the display name. The project folder stays in place.' : 'Folders you can browse and edit together. Available to agents in this workspace.'}</DialogDescription></DialogHeader>
        {contents === 'rename' ? <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault(); if (!target || busy) return; setBusy(true); setError('');
          try { await s.hub.call('renameProject', target, name); await s.refreshState(); setDialog(null); toast.success('Project renamed'); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}><label className="flex flex-col gap-2 text-sm">Project name<Input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} aria-describedby={error ? 'project-action-error' : undefined} /></label><p className="truncate text-xs text-muted-foreground" title={target ?? ''}>{target}</p>{error && <p id="project-action-error" role="alert" className="text-xs text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save name'}</Button></DialogFooter></form>
          : <div className="space-y-4"><ul className="max-h-64 space-y-1 overflow-auto text-xs"><li className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2"><FolderTree className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate" title={target ?? ''}>{target}</span><span className="text-muted-foreground">Main</span></li>{folders.map((value) => <li key={value} className="flex items-center gap-2 px-2"><FolderTree className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate" title={value}>{value}</span><Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`Remove folder ${value}`} onClick={async () => { if (!target) return; setBusy(true); setError(''); try { await saveFolders(target, folders.filter((item) => item !== value)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><X /></Button></li>)}</ul>
            {pathEntry && <form className="flex items-end gap-2" onSubmit={async (event) => { event.preventDefault(); if (!target || busy || !folder.trim()) return; setBusy(true); setError(''); try { await appendFolder(target, folder.trim()); setFolder(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><label className="flex min-w-0 flex-1 flex-col gap-2 text-xs">Folder path<Input required value={folder} onChange={(event) => setFolder(event.target.value)} /></label><Button type="submit" variant="outline" disabled={busy || !folder.trim()}>Add</Button></form>}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="gap-2"><div className="mr-auto flex gap-2">{native && <Button variant="outline" disabled={busy || !target} onClick={() => target && void pickFolder(target)}><FolderPlus />Add folders</Button>}{!pathEntry && <Button variant="ghost" onClick={() => setPathEntry(true)}>Enter path</Button>}</div><Button onClick={() => setDialog(null)}>Done</Button></DialogFooter>
          </div>}
      </DialogContent>
    </Dialog>
  </>;
}
