import * as React from 'react';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, RefreshCw, Upload, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useStore } from '@/store';
import type { PullRequest, PullRequestCheck, PullRequestStatus, WorktreeStatus } from '@/types';

const message = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
const secret = (text: string) => /looks like a secret/.test(text);

/**
 * A separate copy's GitHub pull request, through the gh CLI: create it (an agent drafts the title and description),
 * follow its checks, hand failing CI logs to the agent, push fixes, and discard the copy once it is merged.
 * The state lives in the conversation header, so a create or fix that takes a while survives the popover closing.
 */
export function usePullRequest({ open, close, refreshCopy }: { open: boolean; close: () => void; refreshCopy: () => void }) {
  const s = useStore(); const t = s.thread; const stored = t?.worktree?.pr;
  const [pr, setPr] = React.useState<PullRequestStatus | null>(null);
  const [busy, setBusy] = React.useState<'create' | 'push' | 'fix' | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null); // reading it from GitHub failed
  const [problem, setProblem] = React.useState<{ text: string; retry?: () => void } | null>(null); // an action failed
  const threadId = t?.id; const branch = t?.worktree?.branch; const current = React.useRef(threadId); current.current = threadId;
  React.useEffect(() => { setPr(null); setError(null); setProblem(null); }, [threadId, branch]);
  const url = pr?.url ?? stored?.url;

  const load = React.useCallback(async () => {
    if (!threadId || !url) return;
    setLoading(true);
    try { const st = await s.hub.call<PullRequestStatus | null>('pullRequestStatus', threadId); if (current.current === threadId) { setPr(st); setError(null); } }
    catch (e) { if (current.current === threadId) setError(message(e)); } finally { setLoading(false); }
  }, [s.hub, threadId, url]);
  // While the popover is open: when it opens, after each turn, and every 15 s while a check is still running.
  const turns = t?.messages.length;
  React.useEffect(() => { if (open && !s.running) load(); }, [open, load, s.running, turns]);
  const pending = pr?.state === 'OPEN' && pr.checks.some((c) => c.bucket === 'pending');
  React.useEffect(() => { if (!open || !pending) return; const id = setInterval(load, 15000); return () => clearInterval(id); }, [open, pending, load]);

  const agent = s.agentOf(s.agentId ?? '').name;
  const create = async (allowSecrets = false) => {
    if (!t || !s.agentId) return;
    setBusy('create'); setProblem(null);
    try {
      const made = await s.hub.call<PullRequest>('createPullRequest', t.id, s.agentId, { allowSecrets });
      if (current.current === t.id) setPr({ ...made, isDraft: false, checks: [], unpushed: 0 });
      toast.success(`Pull request #${made.number} is open`, { description: made.title, action: { label: 'Open', onClick: () => s.hub.call('openExternal', made.url) } });
    } catch (e) {
      const text = message(e);
      if (current.current === t.id) setProblem({ text, retry: secret(text) ? () => create(true) : undefined });
      toast.error('No pull request was created', { description: text });
    } finally { setBusy(null); refreshCopy(); }
  };
  const push = async (allowSecrets = false) => {
    if (!t) return;
    setBusy('push'); setProblem(null);
    try {
      const st = await s.hub.call<PullRequestStatus>('pushPullRequest', t.id, { allowSecrets });
      if (current.current === t.id) setPr(st);
      toast.success(`Pushed to pull request #${st.number}`, { description: 'Its checks run again on GitHub.' });
    } catch (e) {
      const text = message(e);
      if (current.current === t.id) setProblem({ text, retry: secret(text) ? () => push(true) : undefined });
    } finally { setBusy(null); refreshCopy(); }
  };
  const fix = async () => {
    if (!t || !s.agentId) return;
    setBusy('fix'); setProblem(null); close(); // the turn runs in the conversation
    try {
      const r = await s.hub.call<{ ok: boolean; checks: string[] }>('fixFailingChecks', t.id, s.agentId);
      if (r.ok) toast.success(`${agent} worked on ${r.checks.join(', ')}`, { description: 'Look over the change, then push it to the pull request from the branch popover.' });
    } catch (e) { toast.error(message(e)); } finally { setBusy(null); refreshCopy(); }
  };
  return { pr: pr ?? (stored ? { ...stored, isDraft: false, checks: [], unpushed: 0 } : null), busy, loading, error, problem, agent, load, create, push, fix };
}
export type PullRequestState = ReturnType<typeof usePullRequest>;

const CHECK_ICON: Record<PullRequestCheck['bucket'], React.ReactNode> = {
  pass: <CircleCheck className="size-3.5 shrink-0 text-success" />,
  fail: <CircleX className="size-3.5 shrink-0 text-destructive" />,
  pending: <CircleDashed className="size-3.5 shrink-0 animate-spin text-amber-500 [animation-duration:3s]" />,
  skipping: <CircleMinus className="size-3.5 shrink-0 text-muted-foreground" />,
  cancel: <CircleMinus className="size-3.5 shrink-0 text-muted-foreground" />,
};

/** The pull request part of the branch popover. */
export function PullRequestPanel({ p, into, branch, status, disabled, onDiscard }: { p: PullRequestState; into: string; branch: string; status: WorktreeStatus | null; disabled: boolean; onDiscard: () => void }) {
  const s = useStore(); const pr = p.pr;
  const [confirming, setConfirming] = React.useState(false);
  const off = disabled || !!p.busy || s.running;
  const failing = pr?.checks.filter((c) => c.bucket === 'fail') ?? [];
  const toPush = (status?.uncommitted ?? 0) + (pr?.unpushed ?? 0);
  const problem = p.problem && (
    <Alert variant="destructive">
      <AlertTitle>GitHub</AlertTitle>
      <AlertDescription className="break-words">{p.problem.text}</AlertDescription>
      {p.problem.retry && <Button size="xs" variant="outline" className="mt-2 w-fit" disabled={off} onClick={p.problem.retry}>Push anyway</Button>}
    </Alert>
  );

  if (!pr || pr.state === 'CLOSED') {
    const why = !s.agentId ? 'Choose an agent to draft it first.' : status?.missing || status?.merging ? null : status && !status.files.length ? `No changes yet compared with ${into}.` : null;
    return (
      <div className="space-y-2 border-t pt-3">
        {confirming ? (
          <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
            <p>The work on <span className="font-mono">{branch}</span> is committed and pushed to GitHub, then {p.agent} drafts the title and description from this conversation without changing files. The pull request asks to merge into {into}. Tributary uses the GitHub CLI (gh) and your sign-in.</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button size="xs" disabled={off} onClick={() => { setConfirming(false); p.create(); }}>Push and create</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {pr ? <GitPullRequestClosed className="size-3.5 shrink-0" /> : <GitPullRequest className="size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1">{pr ? `Pull request #${pr.number} was closed without merging.` : why ?? 'Push this branch and open a pull request on GitHub.'}</span>
            <Button size="xs" variant="outline" disabled={off || !!why || status?.missing || status?.merging} onClick={() => setConfirming(true)}>{p.busy === 'create' && <Spinner />} Create pull request</Button>
          </div>
        )}
        {p.busy === 'create' && <p className="text-xs text-muted-foreground">Pushing {branch}, and {p.agent} is drafting the description…</p>}
        {problem}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-1.5 text-sm">
        {pr.state === 'MERGED' ? <GitMerge className="size-4 shrink-0 text-violet-600 dark:text-violet-400" /> : <GitPullRequest className="size-4 shrink-0 text-success" />}
        <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={pr.url} onClick={() => s.hub.call('openExternal', pr.url)}>
          <span className="text-muted-foreground">#{pr.number}</span> {pr.title}{pr.isDraft ? ' (draft)' : ''}
        </button>
        <Button size="icon-xs" variant="ghost" aria-label="Open the pull request on GitHub" onClick={() => s.hub.call('openExternal', pr.url)}><ExternalLink /></Button>
        <Button size="icon-xs" variant="ghost" aria-label="Refresh the pull request" disabled={p.loading} onClick={p.load}>{p.loading ? <Spinner /> : <RefreshCw />}</Button>
      </div>
      {pr.state === 'MERGED' ? (
        <Alert>
          <AlertTitle>Merged into {pr.base ?? into}</AlertTitle>
          <AlertDescription>The work is on GitHub now. Discard the copy to remove its folder and branch from this computer.</AlertDescription>
          <Button size="xs" variant="outline" className="mt-2 w-fit" disabled={off} onClick={onDiscard}>Discard copy</Button>
        </Alert>
      ) : (
        <>
          {pr.checks.length > 0 ? (
            <ul className="-mx-1 max-h-40 overflow-auto" aria-label="Checks">
              {pr.checks.map((c) => (
                <li key={`${c.workflow}/${c.name}/${c.link}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-xs">
                  {CHECK_ICON[c.bucket] ?? CHECK_ICON.pending}
                  <span className="min-w-0 flex-1 truncate" title={c.description || c.state}>{c.workflow ? <span className="text-muted-foreground">{c.workflow} / </span> : null}{c.name}</span>
                  {c.link && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${c.name} on GitHub`} onClick={() => s.hub.call('openExternal', c.link)}><ExternalLink className="size-3" /></button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">{p.error ? null : p.loading && !p.pr?.checks.length ? 'Loading checks…' : 'No checks reported yet.'}</p>}
          {(failing.length > 0 || toPush > 0) && (
            <div className="flex flex-wrap justify-end gap-2">
              {toPush > 0 && <Button size="xs" variant="outline" disabled={off} onClick={() => p.push()}>{p.busy === 'push' ? <Spinner /> : <Upload />} Push changes</Button>}
              {failing.length > 0 && <Button size="xs" disabled={off || !s.agentId} onClick={p.fix}>{p.busy === 'fix' ? <Spinner /> : <Wrench />} Fix failing CI with {p.agent}</Button>}
            </div>
          )}
        </>
      )}
      {p.error && <p className="break-words text-xs text-destructive">{p.error}</p>}
      {problem}
    </div>
  );
}
