import * as React from 'react';
import { CircleCheck, CircleX, GitBranch, GitMerge, Play, Trash2 } from 'lucide-react';
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
  const [busy, setBusy] = React.useState<'create' | 'merge' | 'discard' | 'setup' | null>(null);
  const [confirm, setConfirm] = React.useState<'merge' | 'discard' | 'setup' | null>(null);
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
  // Follow a setup script while it runs.
  const setupRunning = status?.setup?.state === 'running';
  React.useEffect(() => { if (!setupRunning) return; const id = setInterval(load, 1500); return () => clearInterval(id); }, [setupRunning, load]);

  // Tasks and the personal workspace are not repositories you merge into.
  if (!s.project || !project || project.kind || t?.task || (!s.git && !copy)) return null;

  const create = async () => {
    setBusy('create');
    try {
      const target = t ?? await s.hub.call<Thread>('createThread', s.project);
      const st = await s.hub.call<WorktreeStatus>('createWorktree', target.id);
      await s.openThread(target.id); s.loadThreads(target.project);
      toast.success('This conversation now works in a separate copy', { description: `On branch ${st.branch}, from the last commit on ${st.into}. Your project folder is unchanged until you merge.` });
      setStatus(st);
      if (st.setup?.state === 'untrusted') setConfirm('setup'); // the project's setup script runs only once you've read it
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
  const runSetup = async (trust?: string) => {
    if (!t) return;
    setBusy('setup');
    try {
      if (trust) await s.hub.call('trustScript', t.project, trust);
      const p = s.hub.call('runSetup', t.id); setTimeout(load, 300);
      const r = await p as { state: string };
      if (r.state === 'failed') toast.error('The setup script failed', { description: 'Its output is in the branch popover.' });
    } catch (e) { toast.error(message(e)); } finally { setBusy(null); load(); }
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
        <Toggle className="separate-copy-toggle" variant="outline" size="sm" pressed={!!copy} disabled={s.running || !!busy} aria-label="Work in a separate copy"
          onPressedChange={(on) => { if (on) create(); else setConfirm('discard'); }}>
          {busy === 'create' ? <Spinner /> : <GitBranch />}<span className="hidden lg:inline">Separate copy</span>
        </Toggle>
      </TooltipTrigger><TooltipContent className="max-w-72">{copy
        ? 'This conversation works in its own git worktree and branch. Turn it off to discard them.'
        : 'Give this conversation its own git worktree and branch, so other conversations can change this project at the same time. Your folder changes only when you merge.'}</TooltipContent></Tooltip>

      {copy && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="separate-copy-branch max-w-48 min-w-0 gap-1 font-mono text-xs text-muted-foreground" aria-label={`Branch ${copy.branch}: status, merge and discard`}>
              <GitBranch className="shrink-0" /><span className="hidden truncate sm:inline">{copy.branch}</span>
              {files.length > 0 && <span className="hidden rounded-full bg-brand/15 sm:inline px-1.5 font-sans text-[10px] leading-4 text-brand">{files.length}</span>}
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
            {status?.setup && !status.missing && (
              <div className="flex items-center gap-1.5 text-xs">
                {status.setup.state === 'running' ? <Spinner className="size-3.5" /> : status.setup.state === 'done' ? <CircleCheck className="size-3.5 text-green-600 dark:text-green-500" />
                  : status.setup.state === 'failed' ? <CircleX className="size-3.5 text-destructive" /> : <Play className="size-3.5 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate" title={status.setup.command}>
                  {{ untrusted: 'Setup script not run yet', pending: 'Setup starting…', running: 'Running setup…', done: `Setup done${status.setup.ms ? ` in ${Math.round(status.setup.ms / 1000)} s` : ''}`, failed: 'Setup failed', stopped: 'Setup stopped' }[status.setup.state]}
                </span>
                {status.setup.state === 'untrusted' ? <Button size="xs" variant="outline" disabled={!!busy} onClick={() => setConfirm('setup')}>Review and run</Button>
                  : ['failed', 'stopped', 'done'].includes(status.setup.state) && <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => runSetup()}>Run again</Button>}
              </div>
            )}
            {status?.setup?.state === 'failed' && status.setup.output && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px]">{status.setup.output.slice(-1500)}</pre>}
            {status && !status.missing && (status.port || status.copied?.length) ? (
              <p className="text-xs text-muted-foreground" title={status.copied?.join('\n')}>
                {status.copied?.length ? `Copied ${plural(status.copied.length, 'ignored file')} (${status.copied.slice(0, 3).join(', ')}${status.copied.length > 3 ? ', …' : ''}). ` : ''}
                {status.port ? <>Ports <span className="font-mono">{status.port}–{status.port + 9}</span> ($TRIBUTARY_PORT, $PORT).</> : null}
              </p>
            ) : null}
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
      <AlertDialog open={confirm === 'setup'} onOpenChange={(v) => setConfirm(v ? 'setup' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run this project's setup script?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes from .tributary/settings.json in the repository and runs in the copy, with the copy's own ports. Once you trust it, it runs by itself in every new copy of this project, until its text changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{status?.setup?.command}</pre>
          <AlertDialogFooter><AlertDialogCancel>Not now</AlertDialogCancel><AlertDialogAction onClick={() => runSetup(status?.setup?.hash)}>Trust and run</AlertDialogAction></AlertDialogFooter>
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
