import * as React from 'react';
import { GitBranch, GitMerge, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChangeCode } from '@/components/conversation';
import { changeCode } from '@/lib/format';
import { useStore } from '@/store';
import type { MergeResult, Thread, WorktreeStatus } from '@/types';

// Errors from the desktop bridge arrive as "Error invoking remote method 'hub': Error: <message>".
const message = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Header controls for a conversation's separate working copy: its own git worktree and branch, so other
 * conversations can change the project at the same time. Merge brings the work back; Discard throws it away.
 */
export function SeparateCopy() {
  const s = useStore(); const t = s.thread; const copy = t?.worktree;
  const project = s.st?.projects.find((p) => p.path === s.project);
  const [status, setStatus] = React.useState<WorktreeStatus | null>(null);
  const [busy, setBusy] = React.useState<'create' | 'merge' | 'discard' | null>(null);
  const [confirm, setConfirm] = React.useState<'merge' | 'discard' | null>(null);
  const [open, setOpen] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const threadId = t?.id; const branch = copy?.branch;
  const load = React.useCallback(async () => {
    if (!threadId || !branch) { setStatus(null); return; }
    try { setStatus(await s.hub.call<WorktreeStatus>('worktreeStatus', threadId)); } catch (e) { setProblem(message(e)); }
  }, [s.hub, threadId, branch]);
  // Refresh when a turn finishes, and whenever the popover opens.
  const turns = t?.messages.length;
  React.useEffect(() => { setProblem(null); }, [threadId, branch]);
  React.useEffect(() => { if (!s.running) load(); }, [load, s.running, turns]);
  React.useEffect(() => { if (open) load(); }, [open, load]);

  // Tasks and the personal workspace are not repositories you merge into.
  if (!s.project || !project || project.kind || t?.task || (!s.git && !copy)) return null;

  const create = async () => {
    setBusy('create');
    try {
      const target = t ?? await s.hub.call<Thread>('createThread', s.project);
      const st = await s.hub.call<WorktreeStatus>('createWorktree', target.id);
      await s.openThread(target.id); s.loadThreads(target.project);
      toast.success('This conversation now works in a separate copy', { description: `On branch ${st.branch}, from the last commit on ${st.into}. Your project folder is unchanged until you merge.` });
    } catch (e) { toast.error(message(e)); } finally { setBusy(null); }
  };
  const merge = async () => {
    if (!t) return;
    setBusy('merge'); setProblem(null);
    try {
      const r = await s.hub.call<MergeResult>('mergeWorktree', t.id);
      toast.success(r.files.length ? `Merged ${plural(r.files.length, 'file')} into ${r.into}` : `Nothing new to merge from ${r.branch}`);
      s.refreshState();
    } catch (e) { setProblem(message(e)); setOpen(true); } finally { setBusy(null); load(); } // a refused merge still commits the copy's work
  };
  const discard = async () => {
    if (!t) return;
    setBusy('discard'); setProblem(null);
    try {
      await s.hub.call('discardWorktree', t.id);
      setOpen(false); await s.openThread(t.id); s.loadThreads(t.project);
      toast.success('Separate copy discarded', { description: 'This conversation works in the project folder again.' });
    } catch (e) { toast.error(message(e)); } finally { setBusy(null); }
  };

  const into = status?.into ?? copy?.from ?? 'the current branch';
  const files = status?.files ?? [];
  return (
    <>
      <Tooltip><TooltipTrigger asChild>
        <Toggle variant="outline" size="sm" pressed={!!copy} disabled={s.running || !!busy} aria-label="Work in a separate copy"
          onPressedChange={(on) => { if (on) create(); else setConfirm('discard'); }}>
          {busy === 'create' ? <Spinner /> : <GitBranch />}<span className="hidden lg:inline">Separate copy</span>
        </Toggle>
      </TooltipTrigger><TooltipContent className="max-w-72">{copy
        ? 'This conversation works in its own git worktree and branch. Turn it off to discard them.'
        : 'Give this conversation its own git worktree and branch, so other conversations can change this project at the same time. Your folder changes only when you merge.'}</TooltipContent></Tooltip>

      {copy && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-48 min-w-0 gap-1 font-mono text-xs text-muted-foreground" aria-label={`Branch ${copy.branch}: status, merge and discard`}>
              <span className="truncate">{copy.branch}</span>
              {files.length > 0 && <span className="rounded-full bg-brand/15 px-1.5 font-sans text-[10px] leading-4 text-brand">{files.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96">
            <PopoverHeader>
              <PopoverTitle className="flex items-center gap-1.5"><GitBranch className="size-4 text-muted-foreground" /><span className="truncate font-mono text-[13px]">{copy.branch}</span></PopoverTitle>
              <PopoverDescription>
                {status?.missing ? 'The copy\'s folder is gone. Discard it to work in the project folder again.'
                  : status ? `${plural(status.ahead, 'commit')} ahead of ${into}, ${status.behind} behind. ${status.uncommitted ? `${plural(status.uncommitted, 'change')} not committed yet.` : 'Everything is committed.'}`
                    : 'Loading…'}
              </PopoverDescription>
            </PopoverHeader>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={copy.path}>{copy.path}</p>
            {files.length > 0 ? (
              <ul className="-mx-1 max-h-48 overflow-auto" aria-label="Changed files">
                {files.map((f) => <li key={f.path} className="flex items-center gap-2 rounded-md px-1 py-0.5"><ChangeCode code={changeCode(f.code)} /><span className="truncate font-mono text-[12px]">{f.path}</span></li>)}
              </ul>
            ) : status && !status.missing && <p className="text-xs text-muted-foreground">No changes yet compared with {into}.</p>}
            {problem && (
              <Alert variant="destructive">
                <AlertTitle>Not merged</AlertTitle>
                <AlertDescription className="break-words">{problem}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!!busy || s.running} onClick={() => setConfirm('discard')}><Trash2 /> Discard</Button>
              <Button size="sm" disabled={!!busy || s.running || status?.missing || !files.length} onClick={() => setConfirm('merge')}>{busy === 'merge' ? <Spinner /> : <GitMerge />} Merge into {into}</Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <AlertDialog open={confirm === 'merge'} onOpenChange={(v) => setConfirm(v ? 'merge' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge into {into}?</AlertDialogTitle>
            <AlertDialogDescription>
              The work on {copy?.branch} is committed there and merged into {into} in your project folder{files.length ? ` (${plural(files.length, 'file')})` : ''}. If a file conflicts with changes made on {into}, or with uncommitted changes in your folder, nothing is merged and the files are listed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={merge}>Merge</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirm === 'discard'} onOpenChange={(v) => setConfirm(v ? 'discard' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this separate copy?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the folder and the branch {copy?.branch}, with any work you have not merged. The conversation then works in the project folder again. Your project folder does not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={discard}>Discard copy</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
