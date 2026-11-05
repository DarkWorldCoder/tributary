import * as React from 'react';
import { Braces, ListTree, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { documentOutline } from '@/lib/language-assistance';
import { outlineSupported, type OutlineItem } from '@/lib/code-outline.mjs';
export function DocumentOutline({ path, text, onSelect }: { path: string; text: string; onSelect: (line: number, column: number) => void }) {
  const [open, setOpen] = React.useState(false); const [items, setItems] = React.useState<OutlineItem[]>([]); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(false); const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!open) return; let alive = true; setBusy(true); setError(false);
    const controller = new AbortController();
    const timer = setTimeout(() => { void documentOutline(path, text, controller.signal).then((next) => { if (alive) setItems(next); }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setBusy(false); }); }, 150);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [open, path, text, retry]);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="icon-sm" variant="ghost" className="workbench-action" disabled={!outlineSupported(path) || text.length > 512 * 1024} aria-label="Document outline" title="Document outline"><ListTree /></Button></PopoverTrigger><PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-0">
    {error ? <div role="alert" className="flex items-center gap-2 p-3 text-xs">Couldn’t load outline.<Button size="xs" variant="ghost" onClick={() => setRetry((n) => n + 1)}><RefreshCw />Retry</Button></div> : <Command><CommandInput aria-label="Find a symbol" placeholder="Find a symbol…" /><CommandList>{busy ? <p role="status" className="p-3 text-xs text-muted-foreground">Reading outline…</p> : <><CommandEmpty>No symbols found.</CommandEmpty>{items.map((item, i) => <CommandItem key={`${item.line}:${item.column}:${i}`} value={`${item.name} ${item.kind} ${item.line}`} onSelect={() => { setOpen(false); onSelect(item.line, item.column); }} style={{ paddingLeft: 8 + Math.min(4, item.depth) * 12 }} className="max-sm:min-h-11"><Braces /><span className="truncate">{item.name}</span><span className="ml-auto text-xs text-muted-foreground">{item.kind} · {item.line}</span></CommandItem>)}</>}</CommandList></Command>}
  </PopoverContent></Popover>;
}
