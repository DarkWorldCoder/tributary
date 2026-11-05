import * as React from 'react';
import { shortcutBindings, shortcutAction } from '../../../core/shortcuts.mjs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ShortcutKeys } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import { useSidebar } from '@/components/ui/sidebar';
import { useStore } from '@/store';
import { useFullscreen } from '@/hooks/use-fullscreen';

export const modifierLabel = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function KeyboardShortcuts() {
  const s = useStore(); const { toggleSidebar } = useSidebar();
  const fullscreen = useFullscreen();
  const { platform, overrides, preferences } = useShortcutPreferences();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [role="alertdialog"], [data-state="open"][role="menu"]')) return;
      if (event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && s.panel.open && s.workspaceExpanded && !document.querySelector('.cm-tooltip, .cm-panel')) {
        event.preventDefault(); event.stopPropagation(); s.setWorkspaceExpanded(false); return;
      }
      if (event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && fullscreen.active && !document.querySelector('.cm-tooltip, .cm-panel')) {
        event.preventDefault(); event.stopPropagation(); void fullscreen.toggle(); return;
      }
      const action = shortcutAction(event, { platform, overrides });
      // Editors and terminals own their key bindings, including saving and commands.
      if ((event.target as HTMLElement)?.closest?.('.cm-editor, .xterm, [contenteditable="true"]') && !['find-file', 'split-terminal', 'new-terminal', 'debug', 'terminal', 'workspace', 'zoom-workspace', 'fullscreen'].includes(action || '')) return;
      if (action) {
        event.preventDefault(); event.stopPropagation();
        if (s.workspaceExpanded && ['sidebar', 'terminal', 'debug', 'new', 'recent'].includes(action)) s.setWorkspaceExpanded(false);
        if (action === 'find-file') { s.openPanel('files'); s.setWorkspaceExpanded(false); requestAnimationFrame(() => window.dispatchEvent(new Event('tributary:find-file'))); }
        else if (action === 'split-terminal' || action === 'new-terminal') { s.setTerminalOpen(true); requestAnimationFrame(() => window.dispatchEvent(new Event(`tributary:${action}`))); }
        else if (action === 'help') s.setShortcutsOpen(true);
        else if (action === 'search') s.setPalette(true);
        else if (action === 'attention') window.dispatchEvent(new Event('tributary:next-attention'));
        else if (action === 'new') { if (s.project) s.newThread(); else s.goHome(); }
        else if (action === 'sidebar') toggleSidebar();
        else if (action === 'fullscreen') void fullscreen.toggle();
        else if (action === 'zoom-workspace') { if (s.project) { s.setWorkspaceExpanded(!s.panel.open || !s.workspaceExpanded); s.openPanel(s.panel.tab); } }
        else if (action === 'recent') s.setRecentOpen(true);
        else if (action === 'activity') window.dispatchEvent(new Event('tributary:live'));
        else if (action === 'room') s.setRoomOpen(true);
        else if (action === 'debug') s.setDebugOpen(!s.debugOpen);
        else if (action === 'team') { if (s.project) s.setTeamOpen(true); }
        else if (action === 'settings') s.openSettings('appearance');
        else if (action === 'focus') { if (window.innerWidth < 768) s.setPanel({ ...s.panel, open: false }); else s.setWorkspaceExpanded(false); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()); }
        else if (s.project) {
          if (action === 'workspace') s.setPanel({ ...s.panel, open: !s.panel.open });
          else if (action === 'terminal') s.setTerminalOpen(!s.terminalOpen);
          else { s.openPanel(action === 'changes' ? 'review' : action); s.setWorkspaceExpanded(false); }
        }
      }
    };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [s, toggleSidebar, platform, overrides, fullscreen.toggle, fullscreen.active]);
  const editorShortcuts = [{ id: 'editor-menu', label: 'Editor context menu', group: 'Editor', keys: ['Shift', 'F10'] }, { id: 'definition', label: 'Go to definition (language server)', group: 'Editor', keys: ['F12'] }, { id: 'find-in-file', label: 'Find in file', group: 'Editor', keys: ['Mod', 'F'] }, { id: 'goto-line', label: 'Go to line', group: 'Editor', keys: ['Alt', 'G'] }, { id: 'format', label: 'Format document', group: 'Editor', keys: ['Shift', 'Alt', 'F'] }, { id: 'wrap', label: 'Wrap lines', group: 'Editor', keys: ['Alt', 'Z'] }, { id: 'breakpoint', label: 'Toggle breakpoint', group: 'Editor', keys: ['F9'] }];
  const debugShortcuts = [{ id: 'debug-continue', label: 'Start / Continue / Pause', group: 'Debugging', keys: ['F5'] }, { id: 'debug-over', label: 'Step over', group: 'Debugging', keys: ['F10'] }, { id: 'debug-into', label: 'Step into', group: 'Debugging', keys: ['F11'] }, { id: 'debug-out', label: 'Step out', group: 'Debugging', keys: ['Shift', 'F11'] }, { id: 'debug-restart', label: 'Restart debugging', group: 'Debugging', keys: ['Mod', 'Shift', 'F5'] }, { id: 'debug-stop', label: 'Stop debugging', group: 'Debugging', keys: ['Shift', 'F5'] }];
  const rows = [...shortcutBindings(overrides), ...editorShortcuts, ...debugShortcuts].filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog open={s.shortcutsOpen} onOpenChange={s.setShortcutsOpen}>
    <DialogContent className="max-h-[85dvh] sm:max-w-xl">
      <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts for {platform === 'mac' ? 'Mac' : 'Windows / Linux'}.</DialogDescription></DialogHeader>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => { s.setShortcutsOpen(false); s.openSettings('shortcuts'); }}>Customize shortcuts</Button>
      <Input aria-label="Find a shortcut" placeholder="Find a shortcut…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="min-h-0 overflow-auto pb-2" role="region" aria-label="Available shortcuts" tabIndex={0}>
        {rows.map((item, i) => <React.Fragment key={item.id}>{rows[i - 1]?.group !== item.group && <h3 className="mt-3 mb-1 text-xs font-medium text-muted-foreground">{item.group}</h3>}<div className="flex items-center justify-between gap-4 border-b py-2.5 text-sm"><span>{item.label}</span><ShortcutKeys keys={item.keys} platform={platform} /></div></React.Fragment>)}
        {!rows.length && <p className="py-6 text-sm text-muted-foreground">No shortcuts match.</p>}
        <p className="pt-4 text-xs leading-5 text-muted-foreground">{preferences.send === 'enter' ? 'Enter' : platform === 'mac' ? '⌘+Enter' : 'Ctrl+Enter'} sends a message. Shift + Enter adds a line. Use {platform === 'mac' ? '⌘' : 'Ctrl'} + S to save in the file editor. Shortcuts apply while Tributary has focus; your host app may reserve some combinations.</p>
      </div>
    </DialogContent>
  </Dialog>;
}
