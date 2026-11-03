import * as React from 'react';
import { toast } from 'sonner';
import { ExternalLink, FileCode2, GitCommitHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChangeCode } from '@/components/conversation';
import { HighlightedCode } from '@/components/markdown';
import { changeCode } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

/** Uncommitted changes in the project, a diff viewer and a commit box. */
export function ReviewTab() {
  const s = useStore(); const g = s.git; const { rel, diff } = s.review;
  const [msg, setMsg] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const pick = async (r: string) => { if (s.hub.platform === 'vscode') s.hub.call('openDiff', s.workdir, r); s.setReview({ open: true, rel: r, diff: await s.hub.call<string>('fileDiff', s.workdir, r) }); };
  const commit = async () => {
    setBusy(true);
    try { const r = await s.hub.call<string>('commit', s.workdir, msg); toast.success(`Committed: ${r || msg}`); setMsg(''); await s.refreshGit(); s.setReview({ open: true, rel: null, diff: '' }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (!g) return <p className="p-6 text-center text-sm text-muted-foreground">This project is not a git repository, so there is nothing to review. Run “git init” in the terminal to start tracking changes.</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="max-h-[38%] shrink-0 border-b">
        <ul className="py-1">
          {g.changed.map((c) => (
            <li key={c.path}>
              <button onClick={() => pick(c.path)} className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-muted/60', c.path === rel && 'bg-accent')}>
                <ChangeCode code={changeCode(c.code)} /><span className="truncate font-mono text-[12.5px]">{c.path}</span>
              </button>
            </li>
          ))}
          {!g.changed.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing to review. The working tree is clean.</li>}
        </ul>
      </ScrollArea>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {rel ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{rel}</span>
              <Button size="xs" variant="outline" onClick={() => s.openFile(rel)}><FileCode2 /> Edit</Button>
              <Button size="xs" variant="ghost" onClick={() => s.hub.call('openFile', s.workdir, rel)} aria-label="Open with the system app"><ExternalLink /></Button>
            </div>
            {diff ? <HighlightedCode code={diff} language="diff" /> : <p className="text-sm text-muted-foreground">No changes in this file.</p>}
          </div>
        ) : g.changed.length ? <p className="pt-6 text-center text-sm text-muted-foreground">Pick a file to see what changed.</p> : null}
      </div>
      {g.changed.length > 0 && (
        <footer className="shrink-0 border-t p-3">
          <InputGroup>
            <InputGroupInput value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) commit(); }} placeholder="Commit message…" aria-label="Commit message" autoComplete="off" spellCheck />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" size="sm" disabled={!msg.trim() || busy} onClick={commit}><GitCommitHorizontal /> Commit all</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <p className="mt-1.5 text-xs text-muted-foreground">Stages every change above and commits on {g.branch || 'the current branch'}.</p>
        </footer>
      )}
    </div>
  );
}
