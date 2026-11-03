import * as React from 'react';
import { toast } from 'sonner';
import { Code2, ExternalLink, Globe, Play, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { projectProfile, localPreviewUrl, type ProjectProfile } from '@/lib/project-profile.mjs';
import { useStore } from '@/store';
import type { FileContent } from '@/types';

export function ProjectPreview() {
  const s = useStore(); const run = useRunInTerminal(); const project = s.workdir || '';
  const [profile, setProfile] = React.useState<ProjectProfile | null>(null); const [error, setError] = React.useState('');
  const [url, setUrl] = React.useState(() => { try { return JSON.parse(localStorage.getItem('tributary.previewUrls') || '{}')[project] || ''; } catch { return ''; } });
  const [shown, setShown] = React.useState(localPreviewUrl(url)); const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    let current = true;
    (async () => { const files = await s.hub.call<string[]>('listFiles', project); const pkg = files.includes('package.json') ? await s.hub.call<FileContent>('readFile', project, 'package.json').catch(() => null) : null; if (current) setProfile(projectProfile(files, pkg?.content)); })().catch(() => { if (current) setError('Could not inspect project files.'); });
    return () => { current = false; };
  }, [s.hub, project]);
  const go = () => {
    const value = localPreviewUrl(url); if (!value) { setError('Enter a localhost, 127.0.0.1 or ::1 address.'); return; }
    setError(''); setShown(value); setRevision((n) => n + 1);
    try { const all = JSON.parse(localStorage.getItem('tributary.previewUrls') || '{}'); localStorage.setItem('tributary.previewUrls', JSON.stringify({ ...all, [project]: value })); } catch { /* optional preference */ }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <form className="workbench-toolbar gap-1 border-b px-2" onSubmit={(e) => { e.preventDefault(); go(); }}><Input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Preview address" placeholder="localhost:3000" className="h-7 min-w-0 font-mono text-xs" /><Button variant="ghost" size="icon-sm" className="workbench-action" type="submit" aria-label="Load preview"><RotateCw /></Button><Button variant="ghost" size="icon-sm" className="workbench-action" disabled={!shown} aria-label="Open preview in browser" type="button" onClick={() => shown && s.hub.call('openExternal', shown)}><ExternalLink /></Button></form>
    {error && <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">{error}</p>}
    <details open={!shown} className="max-h-[55%] shrink-0 overflow-auto border-b px-4 py-3"><summary className="cursor-pointer text-[13px] font-medium">Project tools{profile?.stacks.length ? ` · ${profile.stacks.map((stack) => stack.name).join(', ')}` : ''}</summary>
      <div className="mt-3 space-y-3">
        <Button size="sm" variant="outline" onClick={s.openChecks}>Lint, type check & tests</Button>
        {profile?.entry && <Button size="sm" variant="outline" onClick={() => s.openFile(profile.entry!)}><Code2 />Open entry file</Button>}
        {profile?.commands.map((item) => <div key={item.command} className="flex min-w-0 items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs" title={item.command}>{item.command}</code><Button size="xs" variant="ghost" disabled={s.hub.platform === 'mock'} aria-label={`Run ${item.command} in terminal`} onClick={() => run(item.command, project)}><Play className="size-3" />Run</Button></div>)}
        {!!profile?.commands.length && <p className="text-xs text-muted-foreground">Runs project code in your terminal.</p>}
        {!!profile?.stacks.length && <details><summary className="cursor-pointer text-xs text-muted-foreground">Language extensions for VS Code</summary><ul className="mt-2 space-y-1">{profile.stacks.map((stack) => <li key={stack.name}><button className="flex items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => void s.hub.call('openExternal', `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(stack.extension)}`).catch((e: Error) => toast.error(e.message))}>{stack.name}<ExternalLink className="size-3" /></button></li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Extensions run in VS Code.</p></details>}
        {profile && !profile.stacks.length && <p className="text-xs text-muted-foreground">Browse and edit files in any project folder.</p>}
      </div>
    </details>
    {shown && s.hub.platform !== 'vscode' ? <iframe key={revision} title="App preview" src={shown} sandbox="allow-scripts allow-forms allow-same-origin allow-downloads" className="min-h-0 flex-1 bg-white" /> : <div className="grid min-h-0 flex-1 content-center justify-items-center gap-3 overflow-auto p-6 text-center"><Globe className="size-6 text-muted-foreground" /><p className="text-sm font-medium">{s.hub.platform === 'vscode' && shown ? 'Open preview in your browser' : 'Preview a running app'}</p><p className="max-w-xs text-xs text-muted-foreground">{shown ? 'Use the browser button above.' : 'Start a local server, then enter its address above.'}</p></div>}
  </div>;
}
