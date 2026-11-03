import * as React from 'react';
import { Check, ChevronDown, Cpu, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { InputGroupButton } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { ModelCatalog } from '@/types';

export function ModelPicker() {
  const s = useStore(); const [open, setOpen] = React.useState(false);
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  const [busy, setBusy] = React.useState(false); const [custom, setCustom] = React.useState(''); const [error, setError] = React.useState('');
  const sequence = React.useRef(0); const cache = React.useRef(new Map<string, ModelCatalog>());
  const source = s.agent.connectionId || s.gatewayId || '';
  const gateway = s.st?.gateways.find((g) => g.id === source);
  const key = `${s.agentId}@${source}@${gateway?.baseUrl || ''}@${gateway?.model || ''}`;
  const activeKey = React.useRef(key); activeKey.current = key;
  const load = React.useCallback(async () => {
    const request = ++sequence.current; setBusy(true); setError('');
    try {
      const result = await s.hub.call<ModelCatalog>('modelCatalog', s.agentId, source || null);
      if (request !== sequence.current || activeKey.current !== key) return;
      setCatalog(result); if (!result.error) cache.current.set(key, result);
    } catch { if (request === sequence.current) setError('Could not load models. Check your connection and try Refresh.'); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [s.agentId, s.hub, source, key]);
  React.useEffect(() => {
    setCatalog(null); setCustom(''); setError('');
    if (open) { const saved = cache.current.get(key); if (saved && Date.now() - saved.updatedAt < 300000) { setCatalog(saved); setBusy(false); } else load(); }
    return () => { sequence.current++; };
  }, [open, key, load]);
  const choose = (id: string) => { s.setSelectedModel(id); setOpen(false); };
  const selected = catalog?.models.find((m) => m.id === s.selectedModel);
  const name = s.selectedModel ? selected?.name || s.selectedModel : 'Automatic';
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><InputGroupButton size="sm" className="composer-selector composer-model-trigger rounded-full" data-compact={s.codeLayout} disabled={!s.agentId} aria-label={`Choose model for ${s.agent.name}: ${name}`}><Cpu /><span className={cn("composer-selector-label max-w-36 truncate", s.codeLayout && "max-w-28")}>{name}</span><ChevronDown className="composer-selector-chevron" /></InputGroupButton></PopoverTrigger>
    <PopoverContent align="start" side="top" collisionPadding={16} sticky="always" className="w-96 max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><p className="min-w-0 flex-1 truncate text-sm font-medium">Model for {s.agent.name}</p><Button variant="ghost" size="icon-sm" disabled={busy} onClick={load} aria-label="Refresh models"><RefreshCw /></Button></div>
      <Command className="min-h-0 flex-1"><CommandInput placeholder="Find a model…" /><CommandList className="max-h-64">
        <CommandEmpty>No matching models.</CommandEmpty>
        <CommandGroup heading="Default"><CommandItem value="Automatic default" onSelect={() => choose('')}><Cpu /><span className="flex-1">Automatic</span>{!s.selectedModel && <Check />}</CommandItem></CommandGroup>
        {!!catalog?.models.length && <CommandGroup heading={catalog.source === 'aliases' ? 'Claude model aliases' : catalog.source === 'codex' ? 'Codex model catalog' : catalog.source === 'antigravity' ? 'Antigravity models' : 'Provider models'}>{catalog.models.map((model) => <CommandItem key={model.id} value={`${model.name} ${model.id}`} onSelect={() => choose(model.id)}><div className="min-w-0 flex-1"><p className="truncate">{model.name}</p>{model.id !== model.name && <p className="truncate text-xs text-muted-foreground">{model.id}</p>}{model.hidden && <span className="text-xs text-muted-foreground">Additional model</span>}</div>{s.selectedModel === model.id && <Check />}</CommandItem>)}</CommandGroup>}
        {s.selectedModel && !selected && <CommandGroup heading="Your selection"><CommandItem value={s.selectedModel} onSelect={() => choose(s.selectedModel)}><span className="min-w-0 flex-1 truncate">{s.selectedModel}</span><Check /></CommandItem></CommandGroup>}
      </CommandList></Command>
      <div className="shrink-0 border-t p-3">
        {busy && <p role="status" className="mb-2 text-xs text-muted-foreground">Loading model catalog…</p>}
        {(catalog?.error || error) && <p role="alert" className="mb-2 text-xs text-destructive">{catalog?.error || error}</p>}
        {catalog?.supportsSelection && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const id = custom.trim(); if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@\[\]+-]{0,199}$/.test(id)) { setError('Enter a model ID without spaces, up to 200 characters.'); return; } choose(id); }}><Input aria-label="Custom model ID" placeholder="Custom model ID…" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={200} /><Button size="sm" variant="outline" disabled={!custom.trim() || busy}>Use</Button></form>}
        {catalog && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">About this list</summary><p className="mt-2 leading-5">{catalog.note} Your choice is saved for this assistant and model source in Tributary. It applies to the next message.</p></details>}
      </div>
    </PopoverContent>
  </Popover>;
}
