import * as React from 'react';
import { SHORTCUTS, shortcutAction } from '../../../core/shortcuts.mjs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { useSidebar } from '@/components/ui/sidebar';
import { useStore } from '@/store';

export const modifierLabel = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function KeyboardShortcuts() {
  const s = useStore(); const { toggleSidebar } = useSidebar();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [role="alertdialog"], [data-state="open"][role="menu"]')) return;
      const action = shortcutAction(event);
      // Editors and terminals own their key bindings, including saving and commands.
      if ((event.target as HTMLElement)?.closest?.('.cm-editor, .xterm, [contenteditable="true"]')) return;
      if (action) {
        event.preventDefault();
        if (action === 'help') s.setShortcutsOpen(true);
        else if (action === 'search') s.setPalette(true);
        else if (action === 'new') { if (s.project) s.newThread(); else s.goHome(); }
        else if (action === 'sidebar') toggleSidebar();
        else if (action === 'settings') s.openSettings('appearance');
        else if (action === 'focus') { s.setPanel({ ...s.panel, open: false }); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()); }
        else if (s.project) {
          if (action === 'workspace') s.setPanel({ ...s.panel, open: !s.panel.open });
          else if (action === 'terminal') s.setTerminalOpen(!s.terminalOpen);
          else { s.openPanel(action === 'changes' ? 'review' : action); s.setWorkspaceExpanded(false); }
        }
      } else if (event.key === 'Escape' && s.panel.open && !s.palette) s.setPanel({ ...s.panel, open: false });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [s, toggleSidebar]);
  const editorShortcuts = [{ id: 'format', label: 'Format document', group: 'Editor', keys: ['Shift', 'Alt', 'F'] }, { id: 'wrap', label: 'Wrap lines', group: 'Editor', keys: ['Alt', 'Z'] }];
  const rows = [...SHORTCUTS, ...editorShortcuts].filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog open={s.shortcutsOpen} onOpenChange={s.setShortcutsOpen}>
    <DialogContent className="max-h-[85dvh] sm:max-w-xl">
      <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Move around faster. Editor and terminal shortcuts stay with their tools.</DialogDescription></DialogHeader>
      <Input aria-label="Find a shortcut" placeholder="Find a shortcut…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="min-h-0 overflow-auto pb-2" role="region" aria-label="Available shortcuts" tabIndex={0}>
        {rows.map((item, i) => <React.Fragment key={item.id}>{rows[i - 1]?.group !== item.group && <h3 className="mt-3 mb-1 text-xs font-medium text-muted-foreground">{item.group}</h3>}<div className="flex items-center justify-between gap-4 border-b py-2.5 text-sm"><span>{item.label}</span><span role="group" className="flex shrink-0 gap-1" aria-label={item.keys.map((key) => key === 'Mod' ? modifierLabel() : key).join(' plus ')}>{item.keys.map((key) => <Kbd key={key}>{key === 'Mod' ? modifierLabel() : key}</Kbd>)}</span></div></React.Fragment>)}
        {!rows.length && <p className="py-6 text-sm text-muted-foreground">No shortcuts match.</p>}
        <p className="pt-4 text-xs leading-5 text-muted-foreground">Enter sends a message. Shift + Enter adds a line. Use {modifierLabel()} + S to save in the file editor. Shortcuts apply while Tributary has focus; your host app may reserve some combinations.</p>
      </div>
    </DialogContent>
  </Dialog>;
}
