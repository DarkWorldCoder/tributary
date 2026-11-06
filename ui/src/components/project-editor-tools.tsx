import * as React from 'react';
import { FileCode, RefreshCw, Terminal } from 'lucide-react';
import { useStore } from '@/store';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { ProjectEditorTools } from '@/lib/editor-tools';

export function ProjectEditorToolsPanel() {
  const s = useStore(); const run = useRunInTerminal(); const folderId = React.useId();
  const folders = [...new Set([s.workdir, ...(s.st?.projects.find(item => item.path === s.project)?.folders || [])].filter((folder): folder is string => !!folder))];
  const [selected, setSelected] = React.useState<string | null>(null); const project = selected && folders.includes(selected) ? selected : s.workdir;
  React.useEffect(() => setSelected(null), [s.workdir]);
  const [tools, setTools] = React.useState<ProjectEditorTools | null>(null);
  const [error, setError] = React.useState(''); const [loading, setLoading] = React.useState(false);
  const [plan, setPlan] = React.useState<{ title: string; command: string; project: string } | null>(null);
  const request = React.useRef(0);
  const load = React.useCallback(async (restart = false) => {
    const ticket = ++request.current; setError(''); setLoading(true);
    try {
      const result = project ? await s.hub.call<ProjectEditorTools>(restart ? 'restartEslint' : 'projectEditorTools', project) : null;
      if (ticket === request.current) setTools(result);
    } catch (error) { if (ticket === request.current) { setTools(null); setError((error as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); } }
    finally { if (ticket === request.current) setLoading(false); }
  }, [s.hub, project]);
  React.useEffect(() => {
    setTools(null); setPlan(null); void load();
    const focus = () => void load(); window.addEventListener('focus', focus);
    return () => { ++request.current; window.removeEventListener('focus', focus); };
  }, [load]);
  const open = (rel: string) => { if (project) { s.editFile(rel, undefined, undefined, project); s.setSettings({ ...s.settings, open: false }); } };
  return <section aria-label="Project ESLint" className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h3 className="text-[13px] font-medium">Project ESLint</h3><p className="mt-1 text-xs text-muted-foreground">Live problems and undoable fixes using your project’s ESLint and plugins.</p></div><Button size="xs" variant="ghost" disabled={!project || loading} onClick={() => void load(true)}><RefreshCw />{tools?.eslint.library ? 'Restart ESLint' : 'Rescan ESLint'}</Button></div>
    {!project && <p className="text-xs text-muted-foreground">Open a project folder to set up ESLint.</p>}
    {folders.length > 1 && <div className="space-y-1"><label htmlFor={folderId} className="text-xs text-muted-foreground">Workspace folder</label><NativeSelect id={folderId} value={project || ''} className="w-full" onChange={event => setSelected(event.target.value)}>{folders.map(folder => <NativeSelectOption key={folder} value={folder}>{folder}</NativeSelectOption>)}</NativeSelect></div>}
    {project && <p className="truncate font-mono text-xs text-muted-foreground" title={project}>{project}</p>}
    {loading && !tools && <p role="status" className="text-xs text-muted-foreground">Reading project settings…</p>}
    {error && <div className="space-y-2"><p role="alert" className="break-words text-xs text-destructive">{error}</p><Button size="xs" variant="outline" onClick={() => open('.vscode/settings.json')}>Open project settings</Button></div>}
    {tools && <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><span className={tools.eslint.library ? 'text-success' : 'text-muted-foreground'}>{tools.eslint.library ? `Installed · ESLint ${tools.eslint.version || ''}` : 'Not installed in this folder'}</span><span className="text-muted-foreground">{tools.manager} · {tools.eslint.run === 'onSave' ? 'Check on save' : 'Check as you type'}</span></div>
      {tools.sources.filter(rel => /eslint|\.vscode/.test(rel)).length > 0 && <div className="flex flex-wrap gap-1.5">{tools.sources.filter(rel => /eslint|\.vscode/.test(rel)).map(rel => <Button key={rel} size="xs" variant="outline" className="max-w-full" title={rel} onClick={() => open(rel)}><FileCode /><span className="truncate">{rel}</span></Button>)}</div>}
      <div className="flex flex-wrap gap-2">
        {!tools.eslint.library && <Button size="sm" variant="outline" disabled={!tools.trusted || !tools.hasPackage} onClick={() => project && setPlan({ title: 'Install project ESLint', command: tools.install, project })}><Terminal />Install ESLint</Button>}
        {tools.eslint.library && !tools.sources.some(rel => /(?:^|\/)(?:eslint\.config\.|\.eslintrc)/.test(rel)) && <Button size="sm" variant="outline" disabled={!tools.trusted} onClick={() => project && setPlan({ title: 'Create ESLint config', command: tools.initialize, project })}><Terminal />Create config</Button>}
      </div>
      {!tools.trusted ? <p className="text-xs text-muted-foreground">Trust this project before running its tools.</p> : !tools.hasPackage ? <p className="text-xs text-muted-foreground">Add a package.json in this folder to install project dependencies.</p> : <p className="text-xs text-muted-foreground">Reads .vscode/settings.json, including language overrides and ESLint fix-on-save. Nested packages can use their own local ESLint.</p>}
    </>}
    <Dialog open={!!plan} onOpenChange={open => { if (!open) setPlan(null); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{plan?.title}</DialogTitle><DialogDescription>Runs in this project’s terminal. The package manager may download dependencies and update package files.</DialogDescription></DialogHeader><p className="break-all text-xs text-muted-foreground">{plan?.project}</p><pre className="overflow-x-auto rounded border bg-muted/30 p-3 text-xs">{plan?.command}</pre><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPlan(null)}>Cancel</Button><Button onClick={() => { if (!plan || plan.project !== project) return; run(plan.command, plan.project); setPlan(null); s.setSettings({ ...s.settings, open: false }); }}><Terminal />Run in terminal</Button></div></DialogContent></Dialog>
  </section>;
}
