import * as React from 'react';
import { ChevronDown, ChevronUp, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { diffRows, type DiffRow } from '../../../core/diff-view.mjs';
import { cn } from '@/lib/utils';
import { CommentForm, CommentNote, type ReviewComment } from '@/components/review-comments';

type Target = { side: 'before' | 'after'; line: number };
// The line a comment refers to: the new line for added and unchanged rows, the old one for removed rows.
const target = (row?: DiffRow): Target | null => row?.kind === 'add' || row?.kind === 'context' ? { side: 'after', line: row.after! } : row?.kind === 'remove' ? { side: 'before', line: row.before! } : null;

/** onComment turns on a "+" beside each line to leave a comment for the agent; comments shows saved ones in place. */
export function FileDiff({ diff, comments, onComment, onRemoveComment }: { diff: string; comments?: ReviewComment[]; onComment?: (c: Target & { quote: string; note: string }) => void; onRemoveComment?: (id: string) => void }) {
  const [split, setSplit] = React.useState(false); const [wrap, setWrap] = React.useState(false);
  const surface = React.useRef<HTMLElement>(null);
  const [hunk, setHunk] = React.useState(-1);
  React.useEffect(() => setHunk(-1), [diff]);
  const visitHunk = (direction: number) => { const rows = [...(surface.current?.querySelectorAll<HTMLElement>('[data-diff-hunk]') || [])]; if (!rows.length) return; const index = hunk < 0 ? direction > 0 ? 0 : rows.length - 1 : (hunk + direction + rows.length) % rows.length; setHunk(index); rows[index].focus({ preventScroll: true }); rows[index].scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
  const [draft, setDraft] = React.useState<string | null>(null);
  const keyOf = (t: Target) => `${t.side}:${t.line}`;
  const plus = (row?: DiffRow) => { const t = target(row); return onComment && t ? <button type="button" aria-label={`Comment on ${t.side === 'before' ? 'removed ' : ''}line ${t.line}`} onClick={() => setDraft(keyOf(t))} className="absolute top-1 left-0.5 grid size-4 place-items-center rounded bg-brand font-sans text-[11px] leading-none text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">+</button> : null; };
  // Saved comments and the open comment box go right under their line.
  const extras = (rows: (DiffRow | undefined)[]) => [...new Map(rows.map((row) => [target(row), row] as const).filter(([t]) => t).map(([t, row]) => [keyOf(t!), { t: t!, row: row! }])).values()].map(({ t, row }) => (
    <div key={keyOf(t)} className="sticky left-0 max-w-2xl">
      {comments?.filter((c) => c.side === t.side && c.line === t.line).map((c) => <CommentNote key={c.id} comment={c} onRemove={() => onRemoveComment?.(c.id)} />)}
      {draft === keyOf(t) && <CommentForm onCancel={() => setDraft(null)} onAdd={(note) => { onComment?.({ ...t, quote: row.text, note }); setDraft(null); }} />}
    </div>
  ));
  const parsed = React.useMemo(() => diffRows(diff), [diff]);
  const content = parsed.rows.filter((row) => row.kind !== 'meta');
  const paired = parsed.split.filter((row) => row.left?.kind !== 'meta' || row.right?.kind !== 'meta');
  const color = (row?: DiffRow) => row?.kind === 'add' ? 'bg-success/10' : row?.kind === 'remove' ? 'bg-destructive/10' : row?.kind === 'hunk' ? 'bg-muted text-muted-foreground' : '';
  // One scrolling surface, one row per source line. Wrapped split cells stretch together.
  const splitWidth = Math.max(48, ...paired.map((row) => Math.max(row.left?.text.length ?? 0, row.right?.text.length ?? 0) + 9));
  const textClass = cn('block min-w-0 px-2', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre');
  const cell = (row: DiffRow | undefined, side: 'before' | 'after') => <div className={cn('group relative grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] border-r last:border-r-0', color(row))}>{plus(row)}<span aria-hidden="true" className="select-none border-r px-2 text-right text-muted-foreground">{row?.[side] ?? ''}</span><span className={textClass}>{row?.text || ' '}</span></div>;
  return <section ref={surface} onKeyDown={(event) => { if (event.key === 'F7' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); visitHunk(event.shiftKey ? -1 : 1); } }} aria-label="File comparison" className="min-w-0 overflow-hidden rounded-lg border">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2"><span className="text-xs tabular-nums"><span className="text-success">+{parsed.added}</span><span className="ml-2 text-destructive">−{parsed.removed}</span>{parsed.truncated ? ' (visible portion)' : ''}</span><div role="group" aria-label="Diff layout" className="flex flex-wrap items-center gap-1"><Button size="icon-xs" variant="ghost" aria-label="Previous change" title="Previous change (Shift+F7)" disabled={!content.some((row) => row.kind === 'hunk')} onClick={() => visitHunk(-1)}><ChevronUp /></Button><span role="status" className="text-xs tabular-nums text-muted-foreground">{hunk < 0 ? content.filter((row) => row.kind === 'hunk').length : hunk + 1}{hunk >= 0 ? `/${content.filter((row) => row.kind === 'hunk').length}` : ' changes'}</span><Button size="icon-xs" variant="ghost" aria-label="Next change" title="Next change (F7)" disabled={!content.some((row) => row.kind === 'hunk')} onClick={() => visitHunk(1)}><ChevronDown /></Button><Button size="xs" variant={wrap ? 'secondary' : 'ghost'} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText />Wrap lines</Button><Button size="xs" variant={split ? 'ghost' : 'secondary'} aria-pressed={!split} onClick={() => setSplit(false)}>Unified</Button><Button size="xs" variant={split ? 'secondary' : 'ghost'} aria-pressed={split} onClick={() => setSplit(true)}>Side by side</Button></div></div>
    {split && <div className="grid grid-cols-2 border-b bg-muted text-xs"><span className="border-r px-3 py-2">Original</span><span className="px-3 py-2">Working copy</span></div>}
    <div className="max-w-full overflow-auto font-mono text-xs leading-6" role="region" aria-label={split ? 'Original and working copy changes' : 'Unified file changes'} tabIndex={0}>
      <div className={wrap ? 'w-full' : 'w-max min-w-full'} style={split && !wrap ? { width: `${Math.min(splitWidth, 20000) * 2}ch` } : undefined}>
        {split ? paired.map((row, i) => <React.Fragment key={i}><div tabIndex={row.left?.kind === 'hunk' || row.right?.kind === 'hunk' ? -1 : undefined} data-diff-hunk={row.left?.kind === 'hunk' || row.right?.kind === 'hunk' ? i : undefined} className="grid min-h-6 grid-cols-2 focus-visible:outline-1 focus-visible:outline-ring">{cell(row.left, 'before')}{cell(row.right, 'after')}</div>{extras([row.left, row.right])}</React.Fragment>) : content.map((row, i) => <React.Fragment key={i}><div tabIndex={row.kind === 'hunk' ? -1 : undefined} data-diff-hunk={row.kind === 'hunk' ? i : undefined} className={cn('group relative grid min-h-6 focus-visible:outline-1 focus-visible:outline-ring grid-cols-[2.5rem_2.5rem_1.25rem_minmax(0,1fr)]', color(row))}>{plus(row)}<span aria-hidden="true" className="select-none border-r px-1 text-right text-muted-foreground">{row.before ?? ''}</span><span aria-hidden="true" className="select-none border-r px-1 text-right text-muted-foreground">{row.after ?? ''}</span><span className="select-none text-center">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span><span className={textClass}>{row.text || ' '}</span></div>{extras([row])}</React.Fragment>)}
      </div>
    </div>
    {!content.length && <p className="px-3 py-3 text-sm text-muted-foreground">{parsed.rows.map((row) => row.text).filter(Boolean).join('\n') || 'No text changes.'}</p>}
    {parsed.rows.some((row) => row.kind === 'meta') && <details className="border-t px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Patch details</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{parsed.rows.filter((row) => row.kind === 'meta').map((row) => row.text).join('\n')}</pre></details>}
    {parsed.truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 2,000 diff lines.</p>}
  </section>;
}
