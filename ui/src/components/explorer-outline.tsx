import * as React from 'react';
import { Braces, ChevronRight, RefreshCw } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { documentOutline } from '@/lib/language-assistance';
import { outlineSupported, type OutlineItem } from '@/lib/code-outline.mjs';
import { cn } from '@/lib/utils';

export function ExplorerOutline({ path, text, line, onSelect }: { path: string | null; text: string; line: number; onSelect: (line: number, column: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<{ path: string; items: OutlineItem[] } | null>(null);
  const [error, setError] = React.useState(false); const [busy, setBusy] = React.useState(false); const [retry, setRetry] = React.useState(0);
  const supported = !!path && outlineSupported(path) && text.length <= 512 * 1024;
  React.useEffect(() => {
    if (!open || !path || !supported) return;
    let current = true; setBusy(true); setError(false);
    const timer = setTimeout(() => { void documentOutline(path, text).then((items) => { if (current) setResult({ path, items }); }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setBusy(false); }); }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [open, path, text, supported, retry]);
  const items = result?.path === path ? result.items : [];
  const selected = items.filter((item) => item.line <= line).at(-1);
  return <Collapsible open={open} onOpenChange={setOpen} className="explorer-outline min-h-0 shrink-0 border-t data-[state=open]:flex data-[state=open]:max-h-[40%] data-[state=open]:flex-col">
    <CollapsibleTrigger className="flex h-8 w-full shrink-0 items-center gap-1 px-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring" aria-label="Code outline"><ChevronRight className={cn('size-3.5 shrink-0', open && 'rotate-90')} /><span className="flex-1">OUTLINE</span>{path && <span className="max-w-[55%] truncate text-[11px] font-normal" title={path}>{path.split('/').pop()}</span>}</CollapsibleTrigger>
    <CollapsibleContent className="min-h-0 overflow-auto pb-1">
      {!supported ? <p className="px-4 py-2 text-xs text-muted-foreground">{path ? 'No outline for this file type.' : 'Open a source file.'}</p> : error ? <div role="alert" className="px-3 py-2 text-xs">Couldn’t read symbols.<Button variant="ghost" size="xs" onClick={() => setRetry((value) => value + 1)}><RefreshCw />Retry</Button></div> : <>
        {busy && !items.length ? <p role="status" className="px-4 py-2 text-xs text-muted-foreground">Reading symbols…</p> : !items.length ? <p className="px-4 py-2 text-xs text-muted-foreground">No symbols found.</p> : <ul aria-label="File symbols" className="m-0 list-none p-0">{items.map((item, index) => <li key={`${item.line}:${item.column}:${index}`}><button type="button" aria-current={selected === item ? 'location' : undefined} title={`${item.kind} · line ${item.line}`} onClick={() => onSelect(item.line, item.column)} style={{ paddingLeft: 12 + Math.min(item.depth, 4) * 12 }} className={cn('explorer-row flex w-full min-w-0 items-center gap-1.5 pr-2 text-left text-xs hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring', selected === item && 'bg-accent')}><Braces className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="text-[11px] tabular-nums text-muted-foreground">{item.line}</span></button></li>)}</ul>}
      </>}
    </CollapsibleContent>
  </Collapsible>;
}
