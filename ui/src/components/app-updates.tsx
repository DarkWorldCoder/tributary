import * as React from 'react';
import { Check, Download, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { useAppUpdates } from '@/hooks/use-app-updates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/** A single, quiet notification links back to the update controls. It never installs. */
export function AppUpdateNotice() {
  const s = useStore(); const { state } = useAppUpdates();
  const announced = React.useRef('');
  React.useEffect(() => {
    if (s.hub.platform !== 'desktop') return;
    const off = s.hub.on('show-updates', () => { s.openSettings('about'); void s.hub.call('checkForUpdates').catch((error: Error) => toast.error(error.message)); });
    return () => { if (typeof off === 'function') off(); };
  }, [s.hub, s.openSettings]);
  React.useEffect(() => {
    if (!state?.latestVersion || !['available', 'ready'].includes(state.status) || announced.current === state.latestVersion) return;
    announced.current = state.latestVersion;
    toast.info(`Tributary ${state.latestVersion} is available`, { action: { label: 'View update', onClick: () => s.openSettings('about') } });
  }, [state?.latestVersion, state?.status, s.openSettings]);
  return null;
}

export function AppUpdatesCard() {
  const s = useStore(); const { state, error, call } = useAppUpdates();
  const [token, setToken] = React.useState(''); const [pending, setPending] = React.useState(false);
  if (s.hub.platform !== 'desktop') return null;
  const action = async (method: string, ...args: unknown[]) => { setPending(true); try { return await call(method, ...args); } finally { setPending(false); } };
  const busy = pending || state?.status === 'checking' || state?.status === 'downloading';
  const message = state?.status === 'checking' ? 'Checking GitHub releases…'
    : state?.status === 'current' ? 'You’re up to date.'
    : state?.status === 'available' ? `Version ${state.latestVersion} is available.`
    : state?.status === 'downloading' ? 'Downloading your update…'
    : state?.status === 'ready' ? state.installerOpened ? state.appImage ? 'Replace your current AppImage with the verified download after closing Tributary.' : 'Installer opened. Follow its instructions, then reopen Tributary.' : 'Download verified. Ready to install.'
    : 'Check for a newer version of Tributary.';
  return <section aria-label="App updates" className="space-y-4 rounded-lg border p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-medium text-balance">App updates</h3><p className="mt-1 text-xs text-muted-foreground">Preview channel{state ? ` · ${state.platform === 'darwin' ? 'macOS' : state.platform === 'win32' ? 'Windows' : 'Linux'} ${state.arch}` : ''}</p></div>
      <Button size="sm" variant="outline" disabled={!state || busy || state.status === 'ready'} onClick={() => void action('checkForUpdates')}><RefreshCw />{state?.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
    </div>
    <div role="status" aria-live="polite" className="space-y-2">
      <p className="flex items-center gap-2 text-pretty">{state?.status === 'current' ? <Check className="size-4 shrink-0 text-success" /> : state?.status === 'ready' ? <ShieldCheck className="size-4 shrink-0 text-success" /> : null}{message}</p>
      {state?.fileName && <p className="break-all font-mono text-xs text-muted-foreground">{state.fileName} · {megabytes(state.total)}</p>}
      {state?.status === 'downloading' && <><progress aria-label="Update download" value={state.percent} max={100} className="h-1.5 w-full accent-primary" /><div className="flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground"><span>{megabytes(state.transferred)} / {megabytes(state.total)}</span><Button size="xs" variant="ghost" onClick={() => void call('cancelUpdate')}>Cancel</Button></div></>}
    </div>
    {(error || state?.error) && <p role="alert" className="text-xs leading-5 text-destructive">{error || state?.error}</p>}
    <div className="flex flex-wrap gap-2">
      {!!state?.latestVersion && ['available', 'error'].includes(state.status) && <Button size="sm" disabled={busy} onClick={() => void action('downloadUpdate')}><Download />Download update</Button>}
      {state?.status === 'ready' && <AlertDialog><AlertDialogTrigger asChild><Button size="sm" disabled={busy}>{state.appImage ? 'Show downloaded AppImage' : 'Open installer'}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Install Tributary {state.latestVersion}?</AlertDialogTitle><AlertDialogDescription>Save your editor changes and stop running work first. {state.appImage ? 'We’ll show the verified AppImage so you can replace the current one after closing Tributary.' : 'Your system installer will open. Follow its instructions to update, then reopen Tributary.'} Tributary will not close automatically.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void action('installUpdate')}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
      <Button size="sm" variant="ghost" onClick={() => void s.hub.call('openUpdateDownloads').catch(() => toast.error('Could not open release downloads'))}>Release downloads<ExternalLink /></Button>
    </div>
    {!!state?.notes && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">What’s new in {state.latestVersion}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words leading-6">{state.notes}</p></details>}
    {state && <>
      <div className="flex items-center justify-between gap-4 border-t pt-3"><div><label htmlFor="auto-update-check" className="text-xs font-medium">Check automatically</label><p id="auto-update-help" className="mt-1 text-xs text-muted-foreground">At startup and every 6 hours. Downloads stay manual.</p></div><Switch id="auto-update-check" aria-describedby="auto-update-help" disabled={busy || !state.packaged} checked={state.autoCheck} onCheckedChange={(autoCheck) => void action('configureUpdates', { autoCheck })} /></div>
      {!state.packaged && <p className="text-xs text-muted-foreground">Source checkout: update your code to use the latest changes. You can still check and download installers.</p>}
      <details className="border-t pt-3"><summary className="cursor-pointer text-xs font-medium">GitHub access{state.hasToken ? ' · Connected' : ''}</summary><div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">Private releases need your own GitHub token with Contents: read access to DarkWorldCoder/tributary.</p>
        <label htmlFor="update-github-token" className="sr-only">GitHub token for private updates</label><Input id="update-github-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} placeholder={state.hasToken ? 'Enter a token to replace the saved one' : 'GitHub personal access token'} disabled={busy} />
        <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={busy || !token.trim()} onClick={async () => { const next = await action('configureUpdates', { token }); if (next && !next.error) setToken(''); }}>Save access token</Button>{state.hasToken && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void action('configureUpdates', { clearToken: true })}>Remove token</Button>}</div>
        <p className="text-xs text-muted-foreground">{state.storage === 'encrypted' ? 'Encrypted with your OS keychain.' : 'Kept only until this app closes; no OS keychain is available.'}</p>
      </div></details>
    </>}
  </section>;
}
