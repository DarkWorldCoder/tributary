import * as React from 'react';
import { Download, ExternalLink, Palette, RefreshCw, Shapes, Trash2, Search, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useStore } from '@/store';
import type { ExtensionPack } from '@/lib/extension-appearance';
type CatalogPack = { id: string; name: string; description: string; publisher: string; version: string; downloads: number };
export function ExtensionPacksPanel() {
  const s = useStore(); const [packs, setPacks] = React.useState<ExtensionPack[]>([]); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const load = React.useCallback(() => s.hub.call<ExtensionPack[]>('extensionPacks').then(setPacks).catch((error) => setError(error.message)), [s.hub]);
  React.useEffect(() => { if (s.hub.platform === 'desktop') void load(); }, [load, s.hub.platform]);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<CatalogPack[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState('');
  const [installing, setInstalling] = React.useState<string | null>(null);
  const [searchRevision, searchAgain] = React.useReducer((value) => value + 1, 0);
  React.useEffect(() => {
    if (s.hub.platform !== 'desktop') return;
    let active = true; setSearching(true); setCatalogError('');
    const timer = setTimeout(() => {
      s.hub.call<CatalogPack[]>('searchExtensionPacks', query).then((items) => { if (active) setResults(items); }, (error: Error) => { if (active) { setResults([]); setCatalogError(error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); } }).finally(() => { if (active) setSearching(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [s.hub, s.hub.platform, query, searchRevision]);
  const installCatalog = async (id: string) => {
    setInstalling(id); setError('');
    try { const pack = await s.hub.call<ExtensionPack>('installExtensionPack', id); await load(); await s.refreshState(); toast.success(`Installed ${pack.name}`, { description: 'Choose it under Color theme or File icons.' }); }
    catch (error) { setError((error as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
    finally { setInstalling(null); }
  };
  const save = async (key: 'extensionTheme' | 'extensionIcons', value: string) => { try { await s.hub.call('setSettings', { [key]: value }); const theme = packs.flatMap((pack) => pack.themes).find((theme) => theme.id === value); if (key === 'extensionTheme' && theme) s.setTheme(theme.dark ? 'dark' : 'light'); await s.refreshState(); } catch (error) { setError((error as Error).message); } };
  const install = async () => { setBusy(true); setError(''); try { const pack = await s.hub.call<ExtensionPack | null>('importExtensionPack'); if (pack) { await load(); await s.refreshState(); toast.success(`Installed ${pack.name}`); } } catch (error) { setError((error as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); } finally { setBusy(false); } };
  if (s.hub.platform !== 'desktop') return <p className="text-[13px] text-muted-foreground">Manage themes and icons in VS Code’s Extensions view.</p>;
  return <section aria-label="Theme and icon extensions" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Extensions</h2><p className="mt-1 text-[13px] text-muted-foreground">Install VS Code-compatible themes and file icons directly.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => s.hub.call('openExternal', 'https://open-vsx.org/')}><ExternalLink />Browse Open VSX</Button><Button size="sm" variant="outline" disabled={busy || !!installing} onClick={() => void install()}><Download />{busy ? 'Importing…' : 'From file…'}</Button></div></div>
    {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    <section aria-label="Browse extensions" className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-medium">Browse Open VSX</h3><span className="text-xs text-muted-foreground">Themes &amp; icons</span></div>
      <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Search themes and icon extensions" maxLength={160} placeholder="Search themes, icons, or publisher…" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <p className="text-xs text-muted-foreground">No manual downloads. Language servers and formatters are managed in <button className="underline underline-offset-2 hover:text-foreground" onClick={() => s.openSettings('language-tools')}>Language tools</button>.</p>
      {catalogError && <div role="alert" className="flex items-center gap-2 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{catalogError}</span><Button size="xs" variant="outline" onClick={searchAgain}>Retry</Button></div>}
      <div aria-busy={searching} className="max-h-80 overflow-y-auto divide-y">
        {searching ? <p role="status" className="py-4 text-center text-xs text-muted-foreground">Finding extensions…</p> : results.map((item) => {
          const installed = packs.find((pack) => pack.id.toLowerCase() === item.id.toLowerCase());
          return <div key={item.id} className="flex min-w-0 items-center gap-3 py-3"><Palette aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><button className="block max-w-full truncate text-left text-[13px] font-medium hover:underline" title={item.id} onClick={() => s.hub.call('openExternal', `https://open-vsx.org/extension/${item.id.replace('.', '/')}`)}>{item.name}</button><p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{item.publisher} · {item.version}</p></div><Button size="xs" variant={installed ? 'ghost' : 'outline'} disabled={busy || !!installing || installed?.version === item.version} aria-label={`${installed ? installed.version === item.version ? 'Installed' : 'Update' : 'Install'} ${item.name}`} onClick={() => void installCatalog(item.id)}>{installing === item.id ? 'Installing…' : installed?.version === item.version ? <><Check />Installed</> : installed ? 'Update' : <><Download />Install</>}</Button></div>;
        })}
        {!searching && !catalogError && !results.length && <p role="status" className="py-4 text-center text-xs text-muted-foreground">No themes or icon packs match this search.</p>}
      </div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1.5 text-[13px]"><span className="flex items-center gap-2"><Palette className="size-4 text-muted-foreground" />Color theme</span><NativeSelect className="w-full" aria-label="Extension color theme" value={String(s.st?.settings.extensionTheme || '')} onChange={(event) => void save('extensionTheme', event.target.value)}><NativeSelectOption value="">Tributary default</NativeSelectOption>{packs.map((pack) => pack.themes.map((theme) => <NativeSelectOption key={theme.id} value={theme.id}>{theme.label}</NativeSelectOption>))}</NativeSelect></label>
      <label className="space-y-1.5 text-[13px]"><span className="flex items-center gap-2"><Shapes className="size-4 text-muted-foreground" />File icons</span><NativeSelect className="w-full" aria-label="Extension file icons" value={String(s.st?.settings.extensionIcons || '')} onChange={(event) => void save('extensionIcons', event.target.value)}><NativeSelectOption value="">Tributary default</NativeSelectOption>{packs.map((pack) => pack.iconThemes.map((icons) => <NativeSelectOption key={icons.id} value={icons.id}>{icons.label}</NativeSelectOption>))}</NativeSelect></label>
    </div>
    <div className="flex items-center justify-between border-b pb-2 text-xs text-muted-foreground"><span>{packs.length} installed {packs.length === 1 ? 'pack' : 'packs'}</span><Button variant="ghost" size="icon-xs" aria-label="Refresh extension packs" onClick={() => void load()}><RefreshCw /></Button></div>
    {!packs.length && <div className="py-6 text-center text-[13px] text-muted-foreground">Find a theme or icon pack above and select Install.</div>}
    {packs.map((pack) => <div key={pack.id} className="flex min-w-0 items-center gap-3 border-b pb-3"><div className="min-w-0 flex-1"><h3 className="truncate text-[13px] font-medium">{pack.name} <span className="text-xs font-normal text-muted-foreground">{pack.version}</span></h3><p className="mt-1 text-xs text-muted-foreground">{pack.publisher} · {pack.themes.length} themes · {pack.iconThemes.length} icon packs</p>{pack.hasRuntime && <p className="mt-1 text-xs text-muted-foreground">Themes and icons only; extension code is inactive.</p>}</div><AlertDialog><AlertDialogTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Remove ${pack.name}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {pack.name}?</AlertDialogTitle><AlertDialogDescription>Active themes and icons from this pack return to Tributary defaults.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async () => { await s.hub.call('removeExtensionPack', pack.id); await load(); await s.refreshState(); }}>Remove pack</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>)}
  </section>;
}
