import * as React from 'react';
import { toast } from 'sonner';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { commentsMessage, type LineComment } from '@/lib/review-comments.mjs';
import { useStore } from '@/store';

// Comments on diff lines, kept per conversation until they are sent. They live outside the store, so adding one
// re-renders only the diffs and the tray, not the conversation.
export interface ReviewComment extends LineComment { id: string; agent?: string }
const lists = new Map<string, ReviewComment[]>(); const subs = new Set<() => void>(); const EMPTY: ReviewComment[] = [];
const set = (key: string, list: ReviewComment[]) => { if (list.length) lists.set(key, list); else lists.delete(key); subs.forEach((f) => f()); };
export const addComment = (key: string, c: Omit<ReviewComment, 'id'>) => set(key, [...(lists.get(key) || []), { ...c, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
export const removeComment = (key: string, id: string) => set(key, (lists.get(key) || []).filter((c) => c.id !== id));
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useComments(key: string | null | undefined) { return React.useSyncExternalStore(subscribe, () => (key && lists.get(key)) || EMPTY); }
/** Comments belong to the open conversation, or to the folder when there is none. */
export function useCommentsKey() { const s = useStore(); return s.thread ? `thread:${s.thread.id}` : s.workdir ? `folder:${s.workdir}` : null; }

/** What to attach to one diff line, and the box to write it in. */
export function CommentForm({ onAdd, onCancel }: { onAdd: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = React.useState('');
  const add = () => { if (note.trim()) onAdd(note.trim()); };
  return (
    <div className="flex flex-col gap-1.5 border-y bg-card p-2 font-sans">
      <Textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the agent change here?" aria-label="Comment on this line" className="min-h-14 text-sm"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } if (e.key === 'Escape') onCancel(); }} />
      <div className="flex justify-end gap-1.5"><Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="xs" disabled={!note.trim()} onClick={add}>Add comment</Button></div>
    </div>
  );
}

/** One saved comment under its line. */
export function CommentNote({ comment, onRemove }: { comment: ReviewComment; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 border-y bg-card px-3 py-1.5 font-sans text-[13px]">
      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-brand" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap">{comment.by && <span className="text-muted-foreground">{comment.by}: </span>}{comment.note}</p>
      <Button size="icon-xs" variant="ghost" aria-label="Remove comment" onClick={onRemove}><X /></Button>
    </div>
  );
}

/**
 * The comments waiting to be sent, with one Send button per agent: the agent whose turn made the change, or the
 * selected agent for changes in the working tree. Sending queues if that agent is busy.
 */
export function CommentTray({ commentsKey }: { commentsKey: string | null }) {
  const s = useStore(); const list = useComments(commentsKey);
  const [sending, setSending] = React.useState(false);
  if (!commentsKey || !list.length) return null;
  const groups = new Map<string, ReviewComment[]>();
  for (const c of list) { const who = c.agent || s.agentId || ''; groups.set(who, [...(groups.get(who) || []), c]); }
  const send = async (agentId: string, items: ReviewComment[]) => {
    setSending(true);
    try {
      await s.send(commentsMessage(items), { agentId: agentId || undefined });
      for (const c of items) removeComment(commentsKey, c.id);
      toast.success(`Sent ${items.length} ${items.length === 1 ? 'comment' : 'comments'} to ${s.agentOf(agentId).name}`);
    } catch (e) { toast.error((e as Error).message); } finally { setSending(false); }
  };
  return (
    <div role="region" aria-label="Review comments" className="flex flex-wrap items-center gap-2 rounded-md border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-xs">
      <MessageSquare className="size-3.5 text-brand" />
      <span className="min-w-0 flex-1 truncate" title={list.map((c) => `${c.file}:${c.line} ${c.note}`).join('\n')}>{list.length} {list.length === 1 ? 'comment' : 'comments'} on {new Set(list.map((c) => c.file)).size === 1 ? list[0].file : `${new Set(list.map((c) => c.file)).size} files`}</span>
      <Button size="xs" variant="ghost" onClick={() => { for (const c of list) removeComment(commentsKey, c.id); }}>Clear</Button>
      {[...groups].map(([agentId, items]) => (
        <Button key={agentId} size="xs" disabled={sending} onClick={() => send(agentId, items)}>Send {items.length === list.length ? '' : `${items.length} `}to {s.agentOf(agentId).name}</Button>
      ))}
    </div>
  );
}
