import * as React from 'react';
import { FileCode2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileTypeIcon } from '@/components/file-type-icon';
import { FileDiff } from '@/components/file-diff';
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
