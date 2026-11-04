import * as React from 'react';
import { ConnectorReport } from '@/components/connector-report';
import { Check, Cpu, Plug, Plus, Trash2 } from 'lucide-react';
import { LocalModelsSetup } from '@/components/local-models';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useStore } from '@/store';
import type { Gateway } from '@/types';

export function Connections() {
  const s = useStore();
  const [form, setForm] = React.useState<Partial<Gateway> | null>(null);
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [localOpen, setLocalOpen] = React.useState(false);
  const connections = s.st?.gateways.filter((g) => g.direct) ?? [];
  const begin = () => { setError(''); setStatus(''); setForm({ name: 'Local assistant', protocol: 'openai', direct: true, baseUrl: 'http://localhost:11434/v1', model: '', maxOutputTokens: 2048, localRuntime: 'ollama' }); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const id = await s.hub.call<string>('saveGateway', { ...form, direct: true, protocol: 'openai' });
      await s.refreshState(); s.setAgentId(`direct:${id}`); s.setGatewayId('');
      setForm(null); setStatus('Connection saved and selected. Test it below or return to your task.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const test = async (id: string) => {
    setBusy(true); setError(''); setStatus('');
    try { const r = await s.hub.call<{ ok: boolean; message: string }>('testConnection', id); if (!r.ok) throw new Error(r.message); setStatus(r.message); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="flex flex-col gap-5">
      <LocalModelsSetup open={localOpen} onOpenChange={setLocalOpen} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"><div className="flex min-w-0 items-center gap-3"><Cpu className="size-5 shrink-0 text-brand" /><div><h3 className="text-sm font-medium">Local models & coding agents</h3><p className="mt-1 text-xs text-muted-foreground">Unsloth, Ollama or LM Studio on this computer.</p></div></div><Button size="sm" variant="outline" onClick={() => setLocalOpen(true)}>Set up local models</Button></div>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Assistant connections</h2><p className="mt-2 max-w-prose text-sm text-pretty text-muted-foreground">Connect directly to a model service for writing, learning, and working with text. You don’t need a coding assistant.</p></div>{!form && <Button size="sm" onClick={begin}><Plus />Add connection</Button>}</div>
      {form && <form onSubmit={save} className="rounded-xl border p-4"><FieldGroup>
        <Field><FieldLabel htmlFor="connection-service">Service</FieldLabel><NativeSelect id="connection-service" defaultValue={form.localRuntime || (form.id ? 'custom' : 'ollama')} onChange={(e) => { const preset = e.target.value; setForm((f) => ({ ...f, baseUrl: preset === 'ollama' ? 'http://localhost:11434/v1' : preset === 'lmstudio' ? 'http://localhost:1234/v1' : preset === 'unsloth' ? 'http://127.0.0.1:8888/v1' : '', name: preset === 'unsloth' ? 'Unsloth' : preset === 'custom' ? 'My assistant' : 'Local assistant', localRuntime: preset === 'custom' ? null : preset as 'unsloth' | 'ollama' | 'lmstudio' })); }}><NativeSelectOption value="unsloth">Unsloth on this computer</NativeSelectOption><NativeSelectOption value="ollama">Ollama on this computer</NativeSelectOption><NativeSelectOption value="lmstudio">LM Studio on this computer</NativeSelectOption><NativeSelectOption value="custom">Another compatible service</NativeSelectOption></NativeSelect><FieldDescription>Local services must already be running with a model available. Other services need a Chat Completions compatible endpoint.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="connection-name">Connection name</FieldLabel><Input id="connection-name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></Field>
        <Field><FieldLabel htmlFor="connection-address">Server address</FieldLabel><Input id="connection-address" value={form.baseUrl || ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required placeholder="https://your-service.example/v1" /><FieldDescription>Your request and conversation context go to this address. Remote services require HTTPS.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="connection-model">Model name</FieldLabel><Input id="connection-model" value={form.model || ''} onChange={(e) => setForm({ ...form, model: e.target.value })} required placeholder="The model name from your service" maxLength={150} /></Field>
        <Field><FieldLabel htmlFor="connection-key">Access key <span className="font-normal text-muted-foreground">If required</span></FieldLabel><Input id="connection-key" type="password" autoComplete="off" value={form.apiKey || ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.hasKey ? 'Saved; enter a key to replace it' : 'Usually not required for local services'} /><FieldDescription>{s.st?.credentialStorage === 'encrypted' ? 'Keys you save are encrypted using this computer’s credential storage.' : s.st?.credentialStorage === 'weak' ? 'No system keyring is running (such as GNOME Keyring or KWallet), so keys can’t be stored safely. New keys are kept only until the app closes.' : 'Credential storage is unavailable here. New keys are kept only until the app closes.'}</FieldDescription></Field>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><label htmlFor="connection-agent" className="text-sm">Local coding agent {form.localRuntime ? '· Project tools with approvals' : '· Choose a local service first'}</label><Switch id="connection-agent" disabled={!form.localRuntime} checked={!!form.localRuntime && !!form.localAgent} onCheckedChange={(localAgent) => setForm({ ...form, localAgent })} /></div>
        <Field><FieldLabel htmlFor="connection-limit">Maximum response length</FieldLabel><NativeSelect id="connection-limit" value={form.maxOutputTokens || 2048} onChange={(e) => setForm({ ...form, maxOutputTokens: Number(e.target.value) })}><NativeSelectOption value={1024}>Short — up to 1,024 tokens</NativeSelectOption><NativeSelectOption value={2048}>Standard — up to 2,048 tokens</NativeSelectOption><NativeSelectOption value={4096}>Long — up to 4,096 tokens</NativeSelectOption></NativeSelect><FieldDescription>This limits output length, not the total price. Provider charges and limits apply; an existing chat subscription may not include API access.</FieldDescription></Field>
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save connection'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Cancel</Button></div>
      </FieldGroup></form>}
      {!form && !connections.length && <div className="rounded-xl border border-dashed p-5"><Plug className="mb-3 size-5 text-muted-foreground" /><p className="font-medium">Choose how you want to connect</p><p className="mt-2 text-sm text-muted-foreground">Add a local model service or a compatible provider. Installed coding assistants remain available in the Agents settings.</p><Button variant="outline" className="mt-4" onClick={begin}>Set up a connection</Button></div>}
      {connections.map((g) => <div key={g.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 font-medium">{g.name}{s.agentId === `direct:${g.id}` && <Check className="size-4 text-brand" />}</p><p className="mt-1 break-all text-xs text-muted-foreground">{g.model} · {g.baseUrl}</p></div><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Remove ${g.name}`} disabled={busy}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove this connection?</AlertDialogTitle><AlertDialogDescription>Its saved key will be removed. Your conversations and documents stay available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { try { await s.hub.call('deleteGateway', g.id); await s.refreshState(); } catch (e) { setError((e as Error).message); } }}>Remove connection</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { s.setAgentId(`direct:${g.id}`); s.setGatewayId(''); setStatus(`${g.name} selected.`); }}>Use assistant</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => test(g.id)}>{busy ? 'Working…' : 'Test connection'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setForm({ ...g, apiKey: '' }); setError(''); setStatus(''); }}>Edit</Button></div><p className="mt-2 text-xs text-muted-foreground">Testing sends a short request to this service and may use paid credits.</p></div>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {status && <p role="status" className="text-sm text-success">{status}</p>}
      <p className="text-xs text-muted-foreground">Chat connections provide text assistance. Enable Local coding agent on a local service to use project tools and approvals. Model capabilities vary.</p>
      <ConnectorReport />
    </section>
  );
}
