/** Unknown counts stay absent; binary changes never masquerade as zero lines. */
export function LineChangeCount({ added, removed, binary }: { added?: number; removed?: number; binary?: boolean }) {
  if (binary) return <span className="shrink-0 text-[11px] text-muted-foreground">Binary</span>;
  if (added == null || removed == null) return null;
  const label = `${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} ${removed === 1 ? 'line' : 'lines'} removed`;
  return <span aria-label={label} title={label} className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums"><span aria-hidden className="text-success">+{added}</span><span aria-hidden className="text-destructive">−{removed}</span></span>;
}
