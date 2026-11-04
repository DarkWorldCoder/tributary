import * as React from 'react';
import { FileCode2, GitBranch, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FileDiff } from '@/components/file-diff';
import { LineChangeCount } from '@/components/line-change-count';
import { workspaceChanges } from '@/lib/workspace-changes.mjs';
import { cn } from '@/lib/utils';
import type { GitInfo, HubBridge } from '@/types';

export function useWorkspaceGit(bridge: HubBridge, project: string, visible: boolean, revision: number) {
  const [git, setGit] = React.useState<GitInfo | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [revisionKey, bumpRevision] = React.useReducer((value) => value + 1, 0);
  const [refreshKey, refresh] = React.useReducer((value) => value + 1, 0);
  React.useEffect(() => {
    if (!visible) return;
    let active = true; let pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try {
        const next = await bridge.call<GitInfo | null>('gitInfo', project);
        if (active) { setGit((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next); setError(''); bumpRevision(); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); pending = false; }
    };
    void load(); const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [bridge, project, visible, revision, refreshKey]);
  return { git, error, loading, refresh, revision: revisionKey };
}

export function WorkspaceChangeList({ project, git, error, loading, refresh, selected, onSelect }: {
  project: string; git: GitInfo | null; error: string; loading: boolean; refresh: () => void; selected: string | null; onSelect: (rel: string) => void;
}) {
  const [filter, setFilter] = React.useState('');
  const changes = React.useMemo(() => workspaceChanges(project, git), [project, git]);
  const shown = changes.filter((file) => `${file.rel} ${file.label}`.toLowerCase().includes(filter.toLowerCase()));
  return <section aria-label="Workspace changes" className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b px-2 py-2">
      <div className="flex items-center gap-1.5 text-xs"><GitBranch className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate" title={git?.branch}>{git?.branch || (git ? 'No commits yet' : 'Changes')}</span><Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Refresh workspace changes" onClick={refresh}><RefreshCw /></Button></TooltipTrigger><TooltipContent>Refresh changes</TooltipContent></Tooltip></div>
      <Input aria-label="Filter workspace changes" placeholder="Find a changed file…" className="h-7 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <p className="text-xs text-muted-foreground">{changes.length} changed {changes.length === 1 ? 'file' : 'files'} · Saved changes</p>
    </div>
    {error && <p role="alert" className="break-words px-3 py-2 text-xs text-destructive">{error}</p>}
    <ul className="min-h-0 flex-1 overflow-auto py-1">
      {shown.map((file) => <li key={file.rel}><button aria-label={`Review ${file.label.toLowerCase()} ${file.rel}`} aria-current={selected === file.rel ? 'page' : undefined} title={file.from ? `${file.from} → ${file.rel}` : file.rel} onClick={() => onSelect(file.rel)} className={cn('flex min-h-8 w-full items-center gap-2 px-2 text-left hover:bg-muted/60 max-sm:min-h-11', selected === file.rel && 'bg-accent')}><FileTypeIcon path={file.rel} /><span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{file.rel.split('/').at(-1)}</span>{file.rel.includes('/') && <span className="block truncate text-[11px] text-muted-foreground">{file.rel.slice(0, file.rel.lastIndexOf('/'))}</span>}</span><LineChangeCount {...file} /><span aria-label={file.label} className={cn('shrink-0 font-mono text-xs', file.status === 'A' ? 'text-success' : file.status === 'D' ? 'text-destructive' : 'text-warning')}>{file.status}</span></button></li>)}
      {!shown.length && <li role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">{loading ? 'Reading changes…' : filter ? 'No changed files match.' : git ? 'No saved changes in this folder.' : 'This folder is not a Git repository.'}</li>}
    </ul>
  </section>;
}

export function WorkspaceFileChange({ bridge, project, rel, revision, visible, dirty, deleted, onEdit, onClose }: {
  bridge: HubBridge; project: string; rel: string; revision: string; visible: boolean; dirty: boolean; deleted: boolean; onEdit: () => void; onClose: () => void;
}) {
  const [result, setResult] = React.useState<{ rel: string; diff: string; error?: string } | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    // Retain the comparison during background updates; never flash a loading view.
    bridge.call<string>('fileDiff', project, rel).then((diff) => { if (active) setResult({ rel, diff }); }, (e: Error) => { if (active) setResult({ rel, diff: '', error: e.message }); });
    return () => { active = false; };
  }, [bridge, project, rel, revision, visible, refresh]);
  const current = result?.rel === rel ? result : null;
  return <section aria-label={`Changes in ${rel}`} className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><FileTypeIcon path={rel} /><div className="min-w-0 flex-1"><h2 className="truncate text-[13px] font-medium" title={rel}>{rel}</h2><p className="text-xs text-muted-foreground">Git baseline → Saved working copy</p></div><Button size="xs" variant="outline" disabled={deleted} onClick={onEdit}><FileCode2 />Edit file</Button><Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Refresh file comparison" onClick={() => setRefresh((value) => value + 1)}><RefreshCw /></Button></TooltipTrigger><TooltipContent>Refresh comparison</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Close file comparison" onClick={onClose}><X /></Button></TooltipTrigger><TooltipContent>Return to editor</TooltipContent></Tooltip></header>
    {dirty && <p role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">Unsaved edits are kept in your editor. Save the file to include them in this comparison.</p>}
    <div className="min-h-0 flex-1 overflow-auto p-3">{!current ? <p role="status" className="text-xs text-muted-foreground">Reading comparison…</p> : current.error ? <p role="alert" className="text-sm text-destructive">{current.error}</p> : current.diff ? <FileDiff diff={current.diff} /> : <p className="text-sm text-muted-foreground">No saved changes in this file.</p>}</div>
  </section>;
}
