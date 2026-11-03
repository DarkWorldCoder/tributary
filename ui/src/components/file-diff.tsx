import * as React from 'react';
import { Button } from '@/components/ui/button';
import { diffRows, type DiffRow } from '../../../core/diff-view.mjs';
import { cn } from '@/lib/utils';

export function FileDiff({ diff }: { diff: string }) {
  const [split, setSplit] = React.useState(false); const parsed = React.useMemo(() => diffRows(diff), [diff]);
  const content = parsed.rows.filter((row) => row.kind !== 'meta');
  const paired = parsed.split.filter((row) => row.left?.kind !== 'meta' || row.right?.kind !== 'meta');
  const color = (row?: DiffRow) => row?.kind === 'add' ? 'bg-success/10' : row?.kind === 'remove' ? 'bg-destructive/10' : row?.kind === 'hunk' ? 'bg-muted text-muted-foreground' : '';
  const cell = (row: DiffRow | undefined, side: 'before' | 'after') => <div className={cn('flex min-w-0 border-r last:border-r-0', color(row))}><span className="w-10 shrink-0 select-none border-r px-2 text-right text-muted-foreground">{row?.[side] ?? ''}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2">{row?.text || ' '}</span></div>;
  return <section aria-label="File comparison" className="overflow-hidden rounded-lg border">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2"><span className="text-xs tabular-nums"><span className="text-success">+{parsed.added}</span><span className="ml-2 text-destructive">−{parsed.removed}</span>{parsed.truncated ? ' (visible portion)' : ''}</span><div role="group" aria-label="Diff layout" className="flex gap-1"><Button size="xs" variant={split ? 'ghost' : 'secondary'} aria-pressed={!split} onClick={() => setSplit(false)}>Unified</Button><Button size="xs" variant={split ? 'secondary' : 'ghost'} aria-pressed={split} onClick={() => setSplit(true)}>Side by side</Button></div></div>
    {split && <div className="grid grid-cols-2 border-b bg-muted text-xs"><span className="border-r px-3 py-2">Original</span><span className="px-3 py-2">Working copy</span></div>}
    <div className="overflow-auto font-mono text-xs leading-6" role="region" aria-label={split ? 'Original and working copy changes' : 'Unified file changes'} tabIndex={0}>{split ? paired.map((row, i) => <div key={i} className="grid grid-cols-2">{cell(row.left, 'before')}{cell(row.right, 'after')}</div>) : content.map((row, i) => <div key={i} className={cn('flex min-w-0', color(row))}><span className="w-10 shrink-0 select-none border-r px-1 text-right text-muted-foreground">{row.before ?? ''}</span><span className="w-10 shrink-0 select-none border-r px-1 text-right text-muted-foreground">{row.after ?? ''}</span><span className="w-5 shrink-0 select-none text-center">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{row.text || ' '}</span></div>)}</div>
    {!content.length && <p className="px-3 py-3 text-sm text-muted-foreground">{parsed.rows.map((row) => row.text).filter(Boolean).join('\n') || 'No text changes.'}</p>}
    {parsed.rows.some((row) => row.kind === 'meta') && <details className="border-t px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Patch details</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{parsed.rows.filter((row) => row.kind === 'meta').map((row) => row.text).join('\n')}</pre></details>}
    {parsed.truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 2,000 diff lines. Open the file in your editor for the complete comparison.</p>}
  </section>;
}
