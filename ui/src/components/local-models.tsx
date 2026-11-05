import * as React from 'react';
import { Check, Cpu, Download, ExternalLink, MessageSquare, RefreshCw } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type ServiceId = 'unsloth' | 'ollama' | 'lmstudio';
interface LocalModel { id: string; name: string; loaded?: boolean }
interface Service {
  id: ServiceId; name: string; baseUrl: string; download: string; docs: string; setup: string;
  models: LocalModel[]; status: 'offline' | 'needs-key' | 'ready' | 'empty' | 'error'; message: string;
}
interface LocalServices { hardware: { platform: string; arch: string; memoryGB: number; availableMemoryGB: number }; services: Service[] }
const statusLabel = (service: Service) => ({ ready: 'Models available', 'needs-key': 'API key needed', empty: 'No models loaded', offline: 'Not connected', error: 'Check setup' })[service.status];

export function LocalModelsSetup({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStore();
  const [result, setResult] = React.useState<LocalServices | null>(null);
  const [service, setService] = React.useState<Service | null>(null);
  const [address, setAddress] = React.useState(''); const [key, setKey] = React.useState('');
  const [model, setModel] = React.useState(''); const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
  const [verifiedAddress, setVerifiedAddress] = React.useState('');
  const [localAgent, setLocalAgent] = React.useState(false);
  const [historyBudget, setHistoryBudget] = React.useState(4000);
  const [localConcurrency, setLocalConcurrency] = React.useState(1);
  const choose = (row: Service) => {
    setService(row); setAddress(row.baseUrl); setVerifiedAddress(row.baseUrl); setKey(''); setSearch('');
    setModel((row.models.find((model) => model.loaded) || row.models[0])?.id || ''); setError('');
  };
  React.useEffect(() => {
    if (!open) { setKey(''); return; }
    let active = true; setBusy(true); setError('');
    void s.hub.call<LocalServices>('localModelServices').then((result) => {
      if (!active) return;
      setResult(result); choose(result.services.find((row) => row.status === 'ready') || result.services[0]);
    }).catch(() => { if (active) setError('Could not detect local services. Close this setup and try again.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, s.hub]);
  const probe = async () => {
    if (!service) return;
    setBusy(true); setError('');
    try {
      const row = await s.hub.call<Service>('inspectLocalModels', { service: service.id, baseUrl: address, apiKey: key });
      setService(row); setAddress(row.baseUrl); setVerifiedAddress(row.baseUrl); setModel((row.models.find((model) => model.loaded) || row.models[0])?.id || '');
      setResult((result) => result ? { ...result, services: result.services.map((service) => service.id === row.id ? row : service) } : result);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const start = async () => {
    if (!service || !model) return;
    setBusy(true); setError('');
    try {
      const id = await s.hub.call<string>('connectLocalModel', { service: service.id, baseUrl: address, apiKey: key, model, historyBudget, localConcurrency, localAgent });
      const root = s.project || await s.hub.call<string>('personalWorkspace');
      const thread = await s.hub.call<import('@/types').Thread>('createThread', root);
      await s.refreshState(); await s.loadThreads(root); await s.openThread(thread.id);
      s.setAgentId(`direct:${id}`); s.setGatewayId(''); setKey(''); onOpenChange(false); s.setSettings({ ...s.settings, open: false });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const models = service?.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <Dialog open={open} onOpenChange={(open) => { if (!busy) onOpenChange(open); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Cpu className="size-5 text-brand" />Local models</DialogTitle><DialogDescription>Use a model on this computer for chat or coding tasks.</DialogDescription></DialogHeader>
    {result && <p className="text-xs tabular-nums text-muted-foreground">{result.hardware.platform === 'darwin' ? 'Mac' : result.hardware.platform === 'win32' ? 'Windows' : 'Linux'} · {result.hardware.arch} · {result.hardware.memoryGB} GB RAM · {result.hardware.availableMemoryGB} GB currently free</p>}
    {!result && busy && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Detecting local model services…</p>}
    {result && service && <>
      <ToggleGroup type="single" value={service.id} onValueChange={(value) => { const row = result.services.find((row) => row.id === value); if (row) choose(row); }} aria-label="Local model service" className="grid w-full grid-cols-3 gap-2" disabled={busy}>
        {result.services.map((row) => <ToggleGroupItem value={row.id} key={row.id} className="h-auto flex-col items-start rounded-lg border px-3 py-3 text-left data-[state=on]:border-brand data-[state=on]:bg-accent"><span className="flex items-center gap-2 text-sm font-medium">{row.status === 'ready' && <Check className="size-3.5 text-success" />}{row.name}</span><span className="text-[11px] font-normal text-muted-foreground">{statusLabel(row)}</span></ToggleGroupItem>)}
      </ToggleGroup>
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3"><p className="text-xs leading-5 text-pretty">{service.setup}</p><div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" onClick={() => void s.hub.call('openExternal', service.download)}><Download />Get {service.name}</Button><Button size="xs" variant="ghost" onClick={() => void s.hub.call('openExternal', service.docs)}>Setup guide<ExternalLink /></Button></div></div>
      <div className="grid items-start gap-3 sm:grid-cols-2"><Field><FieldLabel htmlFor="local-model-address">Local API address</FieldLabel><Input id="local-model-address" value={address} disabled={busy} spellCheck={false} onChange={(event) => { setAddress(event.target.value); setModel(''); }} /><FieldDescription>Use the /v1 address shown by {service.name}.</FieldDescription></Field><Field><FieldLabel htmlFor="local-model-key">API key <span className="font-normal text-muted-foreground">{service.id === 'unsloth' ? 'From Unsloth Settings → API' : 'If enabled'}</span></FieldLabel><Input id="local-model-key" type="password" autoComplete="off" disabled={busy} value={key} onChange={(event) => { setKey(event.target.value); setModel(''); }} placeholder={service.id === 'unsloth' ? 'Your Unsloth API key' : 'Optional'} /></Field></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">{service.message}</p><Button size="sm" variant="outline" disabled={busy || !address.trim()} onClick={() => void probe()}><RefreshCw />{busy ? 'Checking…' : 'Refresh models'}</Button></div>
      {service.models.length > 0 && address === verifiedAddress && <div className="space-y-3 border-t pt-3"><div className="flex items-center justify-between"><label htmlFor="local-chat-model" className="text-sm font-medium">Choose a chat model</label><span className="text-xs tabular-nums text-muted-foreground">{service.models.length} available</span></div>{service.models.length > 8 && <Input aria-label="Find a local model" placeholder="Find a model…" value={search} onChange={(event) => setSearch(event.target.value)} />}
        <NativeSelect id="local-chat-model" className="w-full" disabled={busy} value={model} onChange={(event) => setModel(event.target.value)}><NativeSelectOption value="">Select a model</NativeSelectOption>{models.map((model) => <NativeSelectOption key={model.id} value={model.id}>{model.name}{model.loaded === true ? ' · Loaded' : model.loaded === false ? ' · Available on disk' : ''}</NativeSelectOption>)}</NativeSelect>
        <p className="text-xs text-muted-foreground">Model size and context need extra memory. RAM alone does not confirm GPU compatibility.</p>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3"><div><label htmlFor="local-coding-agent" className="text-sm font-medium">Local coding agent</label><p className="mt-1 text-xs text-muted-foreground">Read and edit project files, run approved commands, and delegate background tasks. Requires a model with tool calling.</p></div><Switch id="local-coding-agent" checked={localAgent} disabled={busy} onCheckedChange={setLocalAgent} /></div>
        <Field><FieldLabel htmlFor="local-history-budget">Chat history budget</FieldLabel><NativeSelect id="local-history-budget" value={historyBudget} disabled={busy} onChange={(event) => setHistoryBudget(Number(event.target.value))}><NativeSelectOption value={4000}>Compact · 4,000 characters</NativeSelectOption><NativeSelectOption value={8000}>Balanced · 8,000 characters</NativeSelectOption><NativeSelectOption value={12000}>Extended · 12,000 characters</NativeSelectOption></NativeSelect><FieldDescription>Compact uses less model context and includes up to 2,000 characters of enabled project memory. Your current message is additional; saved history is kept.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="local-parallel-requests">Parallel local requests</FieldLabel><NativeSelect id="local-parallel-requests" value={localConcurrency} disabled={busy} onChange={(event) => setLocalConcurrency(Number(event.target.value))}><NativeSelectOption value={1}>1 · Lower memory</NativeSelectOption><NativeSelectOption value={2}>2 requests</NativeSelectOption><NativeSelectOption value={4}>4 requests</NativeSelectOption></NativeSelect><FieldDescription>Local chats and built-in agents share this limit. Your model service can keep model and context memory allocated while idle.</FieldDescription></Field>
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="max-w-sm text-xs text-muted-foreground">{localAgent ? 'Commands run on your computer. Use Read-only, Edit files with approvals, or Full access in chat.' : 'Chat only. Turn on Local coding agent for project tools.'}</p><Button disabled={busy || !model || service?.status !== 'ready' || address !== verifiedAddress} onClick={() => void start()}><MessageSquare />{localAgent ? 'Start local agent' : 'Start local chat'}</Button></div>
  </DialogContent></Dialog>;
}
