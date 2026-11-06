import * as React from 'react';
import { ShortcutKeys } from '@/components/shortcut-settings';
import { useShortcutPreferences } from '@/hooks/use-shortcut-preferences';
import { Check, Download, ExternalLink, RefreshCw, Settings2 } from 'lucide-react';
import { useStore } from '@/store';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { LanguageServerInfo, LanguageToolCatalog, LanguageServerSetting } from '@/lib/language-tools';
function ServerRow({ server, save }: { server: LanguageServerInfo; save: (server: LanguageServerSetting) => Promise<void> }) {
  const s = useStore(); const runInTerminal = useRunInTerminal();
  const [open, setOpen] = React.useState(false); const [command, setCommand] = React.useState(server.command); const [args, setArgs] = React.useState(JSON.stringify(server.args)); const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const update = async (enabled = server.enabled) => { setBusy(true); setError(''); try { await save({ id: server.id, command, args: JSON.parse(args), enabled }); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  return <div className="border-b py-3">
    <div className="flex min-w-0 items-center gap-3"><div className="min-w-0 flex-1"><label htmlFor={`language-server-${server.id}`} className="text-[13px] font-medium">{server.name}</label><p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={server.command}>{server.command}</p></div><span className={`text-xs ${server.available ? 'text-success' : 'text-muted-foreground'}`}>{server.running ? 'Running' : server.available ? 'Installed' : 'Not installed'}</span><Button size="icon-sm" variant="ghost" aria-label={`Configure ${server.name} language server`} aria-expanded={open} onClick={() => setOpen(!open)}><Settings2 /></Button><Switch id={`language-server-${server.id}`} aria-label={`Enable ${server.name} language server`} checked={server.enabled} disabled={busy || !server.available && !server.enabled} onCheckedChange={(checked) => void update(checked)} /></div>
    {open && <div className="mt-3 grid gap-3 rounded border bg-muted/30 p-3"><label className="space-y-1 text-xs">Executable<Input aria-label={`${server.name} server executable`} value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} /></label><label className="space-y-1 text-xs">Arguments (JSON)<Input aria-label={`${server.name} server arguments`} value={args} onChange={(event) => setArgs(event.target.value)} className="font-mono text-xs" spellCheck={false} /></label><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void update()}>Save server</Button>{server.install && <Button size="sm" variant="ghost" title={server.install} onClick={() => { s.setSettings({ ...s.settings, open: false }); runInTerminal(server.install!); }}><Download />Set up in terminal</Button>}</div></div>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}</p>}
  </div>;
}
export function LanguageToolsPanel() {
  const { platform } = useShortcutPreferences();
  const s = useStore(); const [catalog, setCatalog] = React.useState<LanguageToolCatalog | null>(null); const [error, setError] = React.useState('');
  const [savingFormat, setSavingFormat] = React.useState(false);
  const load = React.useCallback(() => { setError(''); s.hub.call<LanguageToolCatalog>('languageToolCatalog').then(setCatalog).catch((error) => setError(error.message)); }, [s.hub]);
  React.useEffect(load, [load]);
  const save = async (server: LanguageServerSetting) => { const next = (catalog?.servers || []).map((item) => ({ id: item.id, command: item.command, args: item.args, enabled: item.enabled })).map((item) => item.id === server.id ? server : item); setCatalog(await s.hub.call<LanguageToolCatalog>('configureLanguageTools', next)); await s.refreshState(); };
  return <section aria-label="Language tools" className="space-y-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-base font-semibold">Language tools</h2><p className="mt-1 text-[13px] text-muted-foreground">Formatting, completions and diagnostics for your files.</p></div><Button size="sm" variant="outline" onClick={load}><RefreshCw />Rescan</Button></div>
    <p className="text-xs text-muted-foreground">Enabled servers start when their files open in a trusted project.</p>
    {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    <div className="flex items-center gap-3 rounded-md border px-3 py-3"><label htmlFor="format-on-save" className="min-w-0 flex-1"><span className="text-[13px] font-medium">Format on save</span><p className="mt-1 text-xs text-muted-foreground">Uses your project’s formatter, Prettier config and EditorConfig. Without rules, infers the file’s existing style.</p></label><Switch id="format-on-save" checked={s.st?.settings.formatOnSave !== false} disabled={savingFormat} onCheckedChange={async (formatOnSave) => { setSavingFormat(true); setError(''); try { await s.hub.call('setSettings', { formatOnSave }); await s.refreshState(); } catch (error) { setError((error as Error).message); } finally { setSavingFormat(false); } }} /></div>
    <div className="space-y-2 pt-2"><h3 className="text-[13px] font-medium">Format document <span className="ml-2 font-normal"><ShortcutKeys keys={['Shift', 'Alt', 'F']} platform={platform} /></span></h3>
      <div className="divide-y rounded-md border">{catalog?.formatters.map((formatter) => <div key={formatter.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="min-w-0 flex-1 basis-40"><p className="text-[13px] font-medium">{formatter.command || 'Prettier'}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatter.name}</p></div>
        <span className={`inline-flex items-center gap-1 text-xs ${formatter.available ? 'text-success' : 'text-muted-foreground'}`}>{formatter.available ? <><Check className="size-3" />{formatter.bundled ? 'Included' : 'Ready'}</> : 'Not installed'}</span>
        {formatter.docs && <Button size="xs" variant="ghost" aria-label={`${formatter.available ? 'Help for' : 'Set up'} ${formatter.command || 'Prettier'}`} onClick={() => void s.hub.call('openExternal', formatter.docs)}>{formatter.available ? 'Guide' : 'Set up'}<ExternalLink /></Button>}
      </div>)}</div>
      <p className="text-xs text-muted-foreground">Format from the editor menu or right-click. Undo with {platform === 'mac' ? '⌘Z' : 'Ctrl+Z'}. Save when ready.</p>
    </div>
    <div><h3 className="text-[13px] font-medium">Language servers</h3>{catalog?.servers.map((server) => <ServerRow key={`${server.id}:${server.command}:${JSON.stringify(server.args)}`} server={server} save={save} />)}</div>
  </section>;
}
