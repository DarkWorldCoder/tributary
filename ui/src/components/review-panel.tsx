import { LineChangeCount } from '@/components/line-change-count';
import * as React from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, FileCode2, GitCommitHorizontal, RefreshCw, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChangeCode } from '@/components/conversation';
import { ChangeContext } from '@/components/change-context';
import { FileDiff } from '@/components/file-diff';
import { CommentTray, addComment, removeComment, useComments, useCommentsKey } from '@/components/review-comments';
import { FileTypeIcon } from '@/components/file-type-icon';
import { Input } from '@/components/ui/input';
import { changeCode } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

/** Uncommitted changes in the project, a diff viewer and a commit box. */
export function ReviewTab() {
  const s = useStore(); const g = s.git; const { rel, diff } = s.review;
  const [msg, setMsg] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState(''); const [error, setError] = React.useState(''); const [loading, setLoading] = React.useState(false);
  const commentsKey = useCommentsKey(); const comments = useComments(commentsKey);
  const selected = React.useRef(rel); selected.current = rel;
  const activeProject = React.useRef(s.workdir); activeProject.current = s.workdir;
  const request = React.useRef(0);
  const label = (code: string) => code.includes('D') ? 'Deleted' : code.includes('R') ? 'Renamed' : code === '??' || code.includes('A') ? 'Added' : code.includes('U') ? 'Conflict' : 'Modified';
  const localPath = (file: string) => { if (!g || !s.workdir || s.workdir === g.root) return file; const prefix = s.workdir.slice(g.root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/'); return file.startsWith(prefix + '/') ? file.slice(prefix.length + 1) : null; };
  const pick = async (r: string) => {
    if (s.hub.platform === 'vscode') s.hub.call('openDiff', s.workdir, r);
    const id = ++request.current; const project = s.workdir; setLoading(true); setError(''); s.setReview({ open: true, rel: r, diff: '' });
    try { const text = await s.hub.call<string>('fileDiff', g?.root || project, r); if (id === request.current && project === activeProject.current) s.setReview({ open: true, rel: r, diff: text }); }
    catch (e) { setError((e as Error).message); } finally { if (id === request.current) setLoading(false); }
  };
  React.useEffect(() => {
    let active = true; let checking = false; const project = s.workdir;
    const refresh = async () => {
      if (checking || !project) return; checking = true;
      try {
        await s.refreshGit(project); const file = selected.current; const id = request.current;
        if (file) { const text = await s.hub.call<string>('fileDiff', g?.root || project, file); if (active && selected.current === file && id === request.current) s.setReview({ open: true, rel: file, diff: text }); }
      } catch (e) { if (active) setError((e as Error).message); } finally { checking = false; }
    };
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [s.workdir, g?.root]);
  const shown = (g?.changed || []).filter((file) => `${file.path} ${label(file.code)}`.toLowerCase().includes(filter.toLowerCase()));
  const commit = async (allowSecrets = false) => {
    setBusy(true);
    try { const r = await s.hub.call<string>('commit', s.workdir, msg, { allowSecrets }); toast.success(`Committed: ${r || msg}`); setMsg(''); await s.refreshGit(); s.setReview({ open: true, rel: null, diff: '' }); }
    catch (e) {
      const text = (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
      // A change that holds what looks like a secret is held back until you say so.
      if (/looks like a secret/.test(text)) toast.error('Not committed', { description: text, duration: 12000, action: { label: 'Commit anyway', onClick: () => commit(true) } });
      else toast.error(text);
    } finally { setBusy(false); }
  };
  if (!g) return <p className="p-6 text-center text-sm text-muted-foreground">This folder has no Git comparison baseline yet. Use Files to browse and watch live edits. Initialize Git when you want a version history and before/after comparisons.</p>;
  return (
    <div className="source-control @container h-full min-h-0"><div className="source-control-layout h-full min-h-0">
      <aside aria-label="Source control" className="source-control-sidebar flex min-h-0 flex-col border-r">
      <div className="shrink-0 space-y-1.5 border-b px-3 py-2"><div className="flex min-h-7 items-center justify-between gap-2"><p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium" title={g.branch}><GitBranch className="size-3.5 shrink-0" /><span className="truncate">{g.branch || 'Working tree'}</span><span className="rounded bg-muted px-1.5 text-xs tabular-nums">{g.changed.length}</span></p><Button variant="ghost" size="icon-xs" aria-label="Refresh changes" onClick={() => s.refreshGit()}><RefreshCw /></Button></div><Input aria-label="Filter changed files" placeholder="Find a changed file…" className="h-7 text-[13px]" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="py-1">
          {shown.map((c) => (
            <li key={c.path}>
              <button onClick={() => pick(c.path)} aria-current={c.path === rel ? 'page' : undefined} className={cn('workbench-list-row flex min-h-8 w-full items-center gap-2 px-3 text-left text-[13px] hover:bg-muted/60 max-sm:h-11', c.path === rel && 'bg-accent')}>
                <FileTypeIcon path={c.path} /><span className="min-w-0 flex-1 text-[13px]" title={c.from ? `${c.from} → ${c.path}` : c.path}><span className="block truncate">{c.path.split('/').at(-1)}</span>{c.path.includes('/') && <span className="block truncate text-[11px] text-muted-foreground">{c.path.slice(0, c.path.lastIndexOf('/'))}</span>}</span><LineChangeCount {...c} /><ChangeCode code={changeCode(c.code)} />
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{filter ? 'No changed files match.' : 'Nothing to review. The working tree is clean.'}</li>}
        </ul>
      </ScrollArea>
      {g.changed.length > 0 && (
        <footer className="shrink-0 border-t p-2">
          <InputGroup className="h-auto flex-col">
            <InputGroupInput className="placeholder:text-foreground" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) commit(); }} placeholder="Commit message…" aria-label="Commit message" autoComplete="off" spellCheck />
            <InputGroupAddon align="block-end" className="px-1 pb-1">
              <InputGroupButton variant="default" className="w-full justify-center" size="sm" disabled={!msg.trim() || busy} onClick={() => commit()}><GitCommitHorizontal /> Commit all</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <p className="mt-1.5 text-xs text-muted-foreground">Commits all listed files.</p>
        </footer>
      )}
      </aside>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <div className="mb-2 empty:hidden"><CommentTray commentsKey={commentsKey} /></div>
        {rel ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={rel}>{rel}</span><Button size="icon-xs" variant="ghost" aria-label="Copy file patch" disabled={!diff} onClick={async () => { try { await navigator.clipboard.writeText(diff); toast.success('Patch copied'); } catch { toast.error('Could not copy this patch'); } }}><Copy /></Button>
              <Button size="xs" variant="outline" disabled={localPath(rel) === null} onClick={() => s.openFile(localPath(rel)!)}><FileCode2 /> Edit</Button>
              <Button size="xs" variant="ghost" disabled={localPath(rel) === null} onClick={() => s.hub.call('openFile', s.workdir, localPath(rel))} aria-label="Open with the system app"><ExternalLink /></Button>
            </div>
            {!loading && <ChangeContext rel={rel} projectRel={localPath(rel)} diff={diff} />}
            {loading ? <p role="status" className="text-sm text-muted-foreground">Loading comparison…</p> : diff ? <FileDiff diff={diff} comments={comments.filter((c) => c.file === (localPath(rel) ?? rel))} onComment={(c) => commentsKey && addComment(commentsKey, { ...c, file: localPath(rel) ?? rel })} onRemoveComment={(id) => commentsKey && removeComment(commentsKey, id)} /> : <p className="text-sm text-muted-foreground">No changes in this file.</p>}
          </div>
        ) : g.changed.length ? <p className="pt-6 text-center text-sm text-muted-foreground">Pick a file to see what changed.</p> : null}
      </div>
    </div></div>
  );
}
