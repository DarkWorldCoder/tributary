import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileTypeIcon } from '@/components/file-type-icon';
import { recentFiles } from '@/lib/workbench-navigation.mjs';

export function FileSwitcher({ visible, paths, active, open, setOpen, onSelect, onRestoreFocus }: { visible: boolean; paths: string[]; active: string | null; open: boolean; setOpen: (open: boolean) => void; onSelect: (path: string) => void; onRestoreFocus?: () => void }) {
  const keyboardPick = React.useRef<string | null>(null);
  const committed = React.useRef(false);
  const history = React.useRef<string[]>([]);
  React.useEffect(() => { history.current = recentFiles(paths, history.current, active); }, [active, paths.join('\n')]);
  const [order, setOrder] = React.useState<string[]>([]); const [selected, setSelected] = React.useState('');
  const selection = React.useRef(selected); selection.current = selected;
  const opened = React.useRef(open); if (open) opened.current = true;
  const commit = React.useCallback((path: string) => { committed.current = !!path; opened.current = false; keyboardPick.current = null; setOpen(false); if (path) onSelect(path); }, [setOpen, onSelect]);
  const handlers = React.useRef({ commit, paths, active, order }); handlers.current = { commit, paths, active, order };
  React.useEffect(() => {
    if (!open) return;
    const next = recentFiles(paths, history.current, active); setOrder(next); setSelected(keyboardPick.current || next[0] || ''); keyboardPick.current = null;
  }, [open]);
  React.useEffect(() => {
    if (!visible) { opened.current = false; setOpen(false); return; }
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.metaKey || event.altKey || event.key !== 'Tab' || !handlers.current.paths.length || (document.querySelector('[role="dialog"], [role="alertdialog"]') && !opened.current)) return;
      event.preventDefault(); event.stopPropagation();
      const wasOpen = opened.current;
      const next = wasOpen ? handlers.current.order : recentFiles(handlers.current.paths, history.current, handlers.current.active);
      if (!opened.current) { setOrder(next); setOpen(true); opened.current = true; }
      const index = next.indexOf(wasOpen ? selection.current : handlers.current.active || '');
      const path = next[(Math.max(0, index) + (event.shiftKey ? next.length - 1 : 1)) % next.length]; keyboardPick.current = path; setSelected(path); selection.current = path;
    };
    const up = (event: KeyboardEvent) => { if (event.key === 'Control' && opened.current) { opened.current = false; handlers.current.commit(selection.current); } };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [visible, setOpen]);
  return <Dialog open={open && visible} onOpenChange={(next) => { if (!next) { keyboardPick.current = null; opened.current = false; } setOpen(next); }}><DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { if (committed.current) { event.preventDefault(); committed.current = false; if (onRestoreFocus) onRestoreFocus(); else requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"] .cm-content')?.focus()); } }} className="gap-0 overflow-hidden p-0 sm:max-w-md"><DialogHeader className="sr-only"><DialogTitle>Switch file</DialogTitle><DialogDescription>Recently used open files. Release Control to switch, or choose a file.</DialogDescription></DialogHeader>
    <Command value={selected} onValueChange={setSelected}><CommandInput placeholder="Find an open file…" aria-label="Find an open file" /><CommandList><CommandEmpty>No matching files.</CommandEmpty>{order.map((path) => <CommandItem key={path} value={path} onSelect={() => commit(path)} className="gap-2 max-sm:min-h-11"><FileTypeIcon path={path} /><span className="min-w-0 flex-1"><span className="block truncate">{path.split('/').pop()}</span><span className="block truncate text-xs text-muted-foreground">{path}</span></span>{path === active && <span className="text-xs text-muted-foreground">Current</span>}</CommandItem>)}</CommandList></Command>
  </DialogContent></Dialog>;
}
