import * as React from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { bindingConflict, bindingFromEvent, shortcutBindings, type ShortcutAction } from '../../../core/shortcuts.mjs';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ShortcutKeys({ keys, platform }: { keys: string[]; platform: 'mac' | 'pc' }) {
  const labels = keys.map((key) => key === 'Mod' ? platform === 'mac' ? '⌘' : 'Ctrl' : key === 'Alt' && platform === 'mac' ? '⌥' : key);
  return <span className="inline-flex flex-wrap justify-end gap-1" aria-label={labels.join(' plus ') || 'Unassigned'}>{labels.length ? labels.map((key) => <Kbd key={key}>{key}</Kbd>) : <span className="text-xs text-muted-foreground">Unassigned</span>}</span>;
}
export function ShortcutLabel({ action }: { action: ShortcutAction }) {
  const { platform, overrides } = useShortcutPreferences();
  return <ShortcutKeys keys={shortcutBindings(overrides).find((row) => row.id === action)?.keys || []} platform={platform} />;
}
export function ShortcutSettings() {
  const { preferences, platform, overrides, update } = useShortcutPreferences();
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState<ShortcutAction | null>(null); const [keys, setKeys] = React.useState<string[] | null>(null); const [error, setError] = React.useState('');
  const rows = shortcutBindings(overrides).filter((row) => `${row.label} ${row.group}`.toLowerCase().includes(query.toLowerCase()));
  const store = (id: ShortcutAction, binding: string[] | undefined) => {
    const next = { ...overrides }; if (binding === undefined) delete next[id]; else next[id] = binding;
    try { update({ ...preferences, profiles: { ...preferences.profiles, [platform]: next } }); setEditing(null); } catch { setError('Could not save this shortcut.'); }
  };
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Keyboard shortcuts</h2><Button size="sm" variant="ghost" onClick={() => { try { update({ ...preferences, profiles: { ...preferences.profiles, [platform]: {} } }); toast.success('Default shortcuts restored'); } catch { toast.error('Could not save shortcuts'); } }}><RotateCcw />Reset shortcuts</Button></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs text-muted-foreground">Keyboard layout<NativeSelect className="w-full" aria-label="Keyboard layout" value={preferences.platform} onChange={(e) => { try { update({ ...preferences, platform: e.target.value as typeof preferences.platform }); } catch { toast.error('Could not save keyboard layout'); } }}><NativeSelectOption value="auto">Automatic ({platform === 'mac' ? 'Mac' : 'Windows / Linux'})</NativeSelectOption><NativeSelectOption value="mac">Mac · Command</NativeSelectOption><NativeSelectOption value="pc">Windows / Linux · Ctrl</NativeSelectOption></NativeSelect></label>
    <label className="space-y-1.5 text-xs text-muted-foreground">Send message<NativeSelect className="w-full" aria-label="Send message shortcut" value={preferences.send} onChange={(e) => { try { update({ ...preferences, send: e.target.value as typeof preferences.send }); } catch { toast.error('Could not save send preference'); } }}><NativeSelectOption value="enter">Enter</NativeSelectOption><NativeSelectOption value="mod-enter">{platform === 'mac' ? '⌘' : 'Ctrl'} + Enter</NativeSelectOption></NativeSelect></label></div>
    <Input aria-label="Find a shortcut" placeholder="Find a shortcut…" value={query} onChange={(e) => setQuery(e.target.value)} />
    <div>{rows.map((row, i) => <React.Fragment key={row.id}>{rows[i - 1]?.group !== row.group && <h3 className="mt-4 mb-1 text-xs font-medium text-muted-foreground">{row.group}</h3>}<div className="flex min-h-11 items-center gap-2 border-b py-1.5 text-[13px]"><span className="min-w-0 flex-1">{row.label}</span><Button variant="ghost" size="sm" className="h-auto min-h-8 max-w-[55%] py-1.5" aria-label={`Change ${row.label} shortcut`} onClick={() => { setEditing(row.id); setKeys(null); setError(''); }}><ShortcutKeys keys={row.keys} platform={platform} /></Button>{overrides[row.id] && <Button size="icon-xs" variant="ghost" aria-label={`Reset ${row.label} shortcut`} onClick={() => store(row.id, undefined)}><RotateCcw /></Button>}</div></React.Fragment>)}{!rows.length && <p className="py-4 text-sm text-muted-foreground">No shortcuts match.</p>}</div>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Editor, terminal & touch devices</summary><p className="mt-2 leading-5">The editor and terminal keep their own shortcuts. Save: {platform === 'mac' ? '⌘' : 'Ctrl'}+S. Format: Shift+Alt+F. Wrap: Alt+Z. Shift+Enter adds a line. On phones and tablets, use the on-screen controls or connect a keyboard. Shortcuts apply while this app has focus.</p></details>
    <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Change shortcut</DialogTitle><DialogDescription>{rows.find((row) => row.id === editing)?.label || 'Keyboard command'}</DialogDescription></DialogHeader>
      <Input aria-label="Record shortcut" placeholder="Press a key combination…" readOnly value={keys?.map((key) => key === 'Mod' ? platform === 'mac' ? '⌘' : 'Ctrl' : key).join(' + ') || ''} onKeyDown={(event) => {
        if (['Tab', 'Escape'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const binding = bindingFromEvent(event.nativeEvent, platform);
        if (!binding) { setError(`Use ${platform === 'mac' ? 'Command' : 'Ctrl'} with a key.`); return; }
        const conflict = editing && bindingConflict(editing, binding, overrides);
        if (conflict) { setKeys(null); setError(`Already used by ${conflict.label}.`); return; }
        if (binding.includes('Mod') && ['Q', 'W', 'R'].includes(binding.at(-1)!) && binding.length === 2) { setKeys(null); setError('This combination is reserved by the app or browser.'); return; }
        setError(''); setKeys(binding);
      }} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <DialogFooter className="flex-wrap"><Button variant="ghost" onClick={() => editing && store(editing, [])}>Unassign</Button><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!keys || !!error} onClick={() => editing && keys && store(editing, keys)}>Save shortcut</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
