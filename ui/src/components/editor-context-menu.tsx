import * as React from 'react';
import type { EditorView } from '@codemirror/view';
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import { gotoLine, openSearchPanel } from '@codemirror/search';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShortcutKeys } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import { useStore } from '@/store';
import { toast } from 'sonner';

type Location = { rel: string; line: number; column: number };
type Navigation = 'definition' | 'typeDefinition' | 'implementation' | 'references';

export function EditorContextMenu({ children, editor, project, path, format, canFormat, hasServer, wrap, toggleWrap }: {
  children: React.ReactElement; editor: React.RefObject<EditorView | null>; project: string | null;
  path: string; format: () => void; canFormat: boolean; hasServer: boolean; wrap: boolean; toggleWrap?: () => void;
}) {
  const s = useStore(); const { platform } = useShortcutPreferences();
  const currentProject = React.useRef(s.workdir); currentProject.current = s.workdir;
  const returnFocus = React.useRef(true); const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [state, setState] = React.useState({ selection: false, undo: false, redo: false, readOnly: false });
  const [busy, setBusy] = React.useState(false);
  const [locations, setLocations] = React.useState<{ title: string; items: Location[]; omitted: number } | null>(null);
  const prepare = (event: React.MouseEvent<HTMLDivElement>) => {
    const view = editor.current; if (!view) return;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    // Preserve an existing selection when the pointer is inside it.
    if (pos != null && !view.state.selection.ranges.some((range) => !range.empty && pos >= range.from && pos <= range.to)) view.dispatch({ selection: { anchor: pos } });
  };
  const snapshot = (open: boolean) => {
    if (!open || !editor.current) return;
    const view = editor.current; returnFocus.current = true;
    setState({ selection: view.state.selection.ranges.some((range) => !range.empty), undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0, readOnly: view.state.readOnly });
  };
  const clipboard = async (action: 'copy' | 'cut' | 'paste') => {
    const view = editor.current; if (!view) return; const original = view.state;
    try {
      if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        if (text.length > 1024 * 1024) throw new Error('Clipboard text is larger than 1 MB.');
        if (editor.current !== view || view.state.doc !== original.doc || !view.state.selection.eq(original.selection)) throw new Error('Document changed. Paste again.');
        if (!view.state.readOnly && text) view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
      } else {
        const text = original.selection.ranges.map((range) => original.sliceDoc(range.from, range.to)).join('\n');
        await navigator.clipboard.writeText(text);
        if (action === 'cut') {
          if (editor.current !== view || view.state.doc !== original.doc || !view.state.selection.eq(original.selection)) throw new Error('Copied. Document changed, so nothing was cut.');
          if (!view.state.readOnly) view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
        }
      }
      view.focus();
    } catch (error) { toast.error((error as Error).message || 'Clipboard unavailable. Use the keyboard shortcut.'); }
  };
  const navigate = async (kind: Navigation, title: string) => {
    const view = editor.current; if (!view || !project || busy) return;
    const doc = view.state.doc; const head = view.state.selection.main.head; const row = doc.lineAt(head);
    returnFocus.current = false; setBusy(true);
    try {
      const result = await s.hub.call<{ supported: boolean; locations: Location[]; omitted: number }>('languageLocations', project, path, doc.toString(), { line: row.number - 1, character: head - row.from }, kind);
      if (!alive.current || editor.current !== view || currentProject.current !== project) return;
      if (view.state.doc !== doc) { toast.message('Document changed. Try navigation again.'); return; }
      if (!result.supported) { toast.message('This language server does not support this action.'); return; }
      if (result.locations.length === 1 && kind !== 'references') s.editFile(result.locations[0].rel, result.locations[0].line, result.locations[0].column, project || undefined);
      else if (result.locations.length) setLocations({ title, items: result.locations, omitted: result.omitted });
      else toast.message(result.omitted ? 'Locations outside this project were omitted.' : 'No locations found.');
    } catch (error) { if (alive.current) toast.error((error as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    finally { if (alive.current) setBusy(false); }
  };
  const command = (fn: (view: EditorView) => unknown) => { returnFocus.current = false; requestAnimationFrame(() => { const view = editor.current; if (view) { view.focus(); fn(view); } }); };
  const item = (label: string, action: () => void, keys?: string[], disabled = false) => <ContextMenuItem disabled={disabled} onSelect={action}><span className="flex-1">{label}</span>{keys && <ShortcutKeys keys={keys} platform={platform} />}</ContextMenuItem>;
  return <>
    <ContextMenu onOpenChange={snapshot}>
      <ContextMenuTrigger asChild onContextMenuCapture={prepare} onKeyDown={(event) => {
        if (event.key === 'F12' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && hasServer) { event.preventDefault(); void navigate('definition', 'Definitions'); return; }
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
          event.preventDefault(); const view = editor.current; const point = view?.coordsAtPos(view.state.selection.main.head);
          if (point) event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: point.left, clientY: point.bottom }));
        }
      }}>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Editor context menu" collisionPadding={8} style={{ minWidth: 0, maxWidth: 'min(calc(100vw - 16px), var(--radix-context-menu-content-available-width, 288px))' }} className="w-72 max-w-[calc(100vw-16px)] rounded-md border [&_[role=menuitem]]:min-h-7 [&_[role=menuitem]]:gap-5 [&_[role=menuitem]]:px-2.5 [&_[role=menuitem]]:text-[13px] max-sm:[&_[role=menuitem]]:min-h-11" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current) editor.current?.focus(); }}>
        {item('Go to definition', () => void navigate('definition', 'Definitions'), ['F12'], !hasServer || busy)}
        {item('Go to type definition', () => void navigate('typeDefinition', 'Type definitions'), undefined, !hasServer || busy)}
        {item('Go to implementation', () => void navigate('implementation', 'Implementations'), undefined, !hasServer || busy)}
        {item('Find references', () => void navigate('references', 'References'), undefined, !hasServer || busy)}
        {!hasServer && item('Set up language tools…', () => { returnFocus.current = false; s.openSettings('language-tools'); })}
        <ContextMenuSeparator />
        {item('Format document', format, ['Shift', 'Alt', 'F'], !canFormat || state.readOnly)}
        {item(wrap ? 'Turn off line wrapping' : 'Wrap lines', () => toggleWrap?.(), ['Alt', 'Z'], !toggleWrap)}
        {item('Find in file', () => command(openSearchPanel), ['Mod', 'F'])}
        {item('Go to line…', () => command(gotoLine), ['Alt', 'G'])}
        <ContextMenuSeparator />
        {item('Undo', () => command(undo), ['Mod', 'Z'], !state.undo || state.readOnly)}
        {item('Redo', () => command(redo), platform === 'mac' ? ['Mod', 'Shift', 'Z'] : ['Mod', 'Y'], !state.redo || state.readOnly)}
        {item('Cut', () => void clipboard('cut'), ['Mod', 'X'], !state.selection || state.readOnly)}
        {item('Copy', () => void clipboard('copy'), ['Mod', 'C'], !state.selection)}
        {item('Paste', () => void clipboard('paste'), ['Mod', 'V'], state.readOnly)}
        {item('Select all', () => command(selectAll), ['Mod', 'A'])}
        <ContextMenuSeparator />
        {item('Ask agent about selection', () => { const view = editor.current; if (!view) return; returnFocus.current = false; const row = view.state.doc.lineAt(view.state.selection.main.from); const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to); s.setDraft(`${s.draft ? `${s.draft}\n` : ''}Explain this code in @${project && project !== s.workdir ? `${project}/${path}` : path}:${row.number}:\n${text}`); s.setWorkspaceExpanded(false); if (innerWidth < 768) s.setPanel({ ...s.panel, open: false }); requestAnimationFrame(() => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]')].find((element) => element.offsetParent)?.focus()); }, undefined, !state.selection)}
        {item('Copy file path', () => { void navigator.clipboard.writeText(path).catch(() => toast.error('Could not copy file path.')); })}
        {project && s.hub.platform !== 'mock' && item('Reveal in file manager', () => { void s.hub.call('revealFile', project, path).catch((error) => toast.error(error.message)); })}
        {project && item('Open project terminal', () => { s.setWorkspaceExpanded(false); s.setTerminalOpen(true); })}
      </ContextMenuContent>
    </ContextMenu>
    {busy && <span role="status" className="pointer-events-none absolute right-3 bottom-3 rounded border bg-popover px-2 py-1 text-xs">Finding locations…</span>}
    <Dialog open={!!locations} onOpenChange={(open) => { if (!open) setLocations(null); }}><DialogContent className="max-h-[80dvh] sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); editor.current?.focus(); }}><DialogHeader><DialogTitle>{locations?.title}</DialogTitle><DialogDescription>Locations in this project{locations?.omitted ? ` · ${locations.omitted} unavailable or additional locations omitted` : ''}.</DialogDescription></DialogHeader><ul className="min-h-0 overflow-y-auto">{locations?.items.map((location) => <li key={`${location.rel}:${location.line}:${location.column}`}><button className="flex min-h-9 w-full items-center justify-between gap-4 rounded px-2 text-left text-[13px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11" onClick={() => { setLocations(null); s.editFile(location.rel, location.line, location.column, project || undefined); }}><span className="min-w-0 truncate" title={location.rel}>{location.rel}</span><span className="shrink-0 text-xs text-muted-foreground">{location.line}:{location.column}</span></button></li>)}</ul></DialogContent></Dialog>
  </>;
}
