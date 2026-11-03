import * as React from 'react';
import { toast } from 'sonner';
import { BookOpen, Cpu, Download, ExternalLink, FilePlus2, Info, KeyRound, LayoutGrid, Monitor, Moon, Palette, Pencil, Plug, Plus, RefreshCw, Share2, Sparkles, Sun, Trash2, Waypoints } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AgentAvatar } from '@/components/agent-avatar';
import { cn } from '@/lib/utils';
import { useStore, type SettingsTab, type Theme, type InterfaceFont } from '@/store';
import type { Gateway, Protocol, RegistryAgent } from '@/types';
import { Connections } from '@/components/connections';

const NAV: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'connections', label: 'Connections', icon: <Plug /> },
  { id: 'agents', label: 'Agents', icon: <Cpu /> },
  { id: 'gateways', label: 'Model gateways', icon: <Waypoints /> },
  { id: 'mcp', label: 'MCP servers', icon: <Plug /> },
  { id: 'skills', label: 'Skills', icon: <Sparkles /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette /> },
  { id: 'about', label: 'About', icon: <Info /> },
];
const MCP_AGENTS = ['claude', 'codex', 'gemini', 'antigravity'];

function Section({ title, description, children, actions }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

type Registry = { source: 'network' | 'cache'; agents: RegistryAgent[] };
// Agents published in the Agent Client Protocol registry. npx and uvx agents run straight away; binaries need a manual download.
function BrowseAgents({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useStore(); const [reg, setReg] = React.useState<Registry | null>(null); const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async (refresh = false) => {
    setError(''); if (refresh) setReg(null);
    try { setReg(await s.hub.call<Registry>('registry', { refresh })); } catch (e) { setError((e as Error).message); }
  }, [s.hub]);
  React.useEffect(() => { if (open) load(); }, [open, load]);
  const toggle = async (a: RegistryAgent) => {
    if (busy || (!a.installed && !a.install.runnable)) return;
    setBusy(a.id);
    try {
      if (a.installed) { await s.hub.call('removeRegistryAgent', a.id); toast.success(`Removed ${a.name}`); }
      else { await s.hub.call('installRegistryAgent', a.id); toast.success(`Added ${a.name}`, { description: `${a.install.kind} downloads it the first time you use it.` }); }
      await s.refreshState(); await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(620px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Browse agents</DialogTitle>
          <DialogDescription>Agents from the Agent Client Protocol registry. Adding one puts it in your agents list; it runs through npx or uvx, which download it on first use.</DialogDescription>
        </DialogHeader>
        <Command className="min-h-0 flex-1 rounded-none! border-t bg-transparent" label="Registry agents">
          <CommandInput placeholder="Search agents…" />
          <CommandList className="max-h-none flex-1">
            {!reg && !error && <div className="flex flex-col gap-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>}
            {error && <p className="p-4 text-sm text-destructive">Could not load the registry: {error}</p>}
            {reg && <CommandEmpty>No agents match.</CommandEmpty>}
            {reg && (
              <CommandGroup>
                {reg.agents.map((a) => (
                  <CommandItem key={a.id} value={a.id} keywords={[a.name, a.description]} onSelect={() => toggle(a)} className="items-start gap-3 py-2.5 [&>svg:last-child]:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {a.name}{a.version && <span className="text-xs font-normal text-muted-foreground">{a.version}</span>}
                        {a.install.runnable ? <Badge variant="outline" className="font-mono font-normal">{a.install.kind}</Badge> : <Badge variant="secondary" className="font-normal">{a.install.kind === 'binary' ? 'binary: not supported yet' : 'not supported yet'}</Badge>}
                        {a.installed && <Badge className="bg-success/15 text-success">Added</Badge>}
                      </div>
                      {a.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 self-center">
                      {a.website && <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); s.hub.call('openExternal', a.website); }} aria-label={`${a.name} website`}><ExternalLink /></Button>}
                      {a.installed
                        ? <Button size="xs" variant="outline" disabled={busy === a.id} onClick={(e) => { e.stopPropagation(); toggle(a); }}><Trash2 /> Remove</Button>
                        : <Button size="xs" disabled={!a.install.runnable || busy === a.id} title={a.install.runnable ? undefined : 'Download it from the agent’s website, then add it as a custom agent'} onClick={(e) => { e.stopPropagation(); toggle(a); }}><Download /> Install</Button>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex-1">{reg?.source === 'cache' ? 'Offline: showing the saved copy of the registry.' : reg ? `${reg.agents.length} agents in the registry` : ''}</span>
          <Button size="xs" variant="ghost" onClick={() => load(true)} disabled={!reg && !error}><RefreshCw /> Refresh</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgentsTab() {
  const s = useStore(); const [busy, setBusy] = React.useState(false); const [browsing, setBrowsing] = React.useState(false);
  const agents = [...(s.st?.agents ?? [])].sort((a, b) => Number(b.available && b.headless) - Number(a.available && a.headless));
  return (
    <Section title="Agents" description="Tributary finds coding agents installed on this computer and runs them through their own headless or Agent Client Protocol mode. Sign-ins, sessions and settings stay with each agent."
      actions={<>
        <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); await s.hub.call('rescan'); await s.refreshState(); setBusy(false); toast.success('Agents rescanned'); }}><RefreshCw className={cn(busy && 'animate-spin')} /> Rescan</Button>
        <Button variant="outline" size="sm" onClick={() => s.hub.call('openAgentsFile')}><FilePlus2 /> Add a custom agent</Button>
        <Button size="sm" onClick={() => setBrowsing(true)}><LayoutGrid /> Browse agents</Button>
      </>}>
      <BrowseAgents open={browsing} onOpenChange={setBrowsing} />
      <div className="flex flex-col gap-2">
        {agents.map((a) => (
          <Item key={a.id} variant="outline" className="items-start">
            <ItemMedia><AgentAvatar agent={a} size="lg" muted={!a.available} /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex flex-wrap items-center gap-2">
                {a.name}<span className="font-normal text-muted-foreground">{a.vendor}</span>
                {a.available ? (a.headless ? <Badge className="bg-success/15 text-success">Ready</Badge> : <Badge variant="secondary">Installed, needs setup</Badge>) : <Badge variant="outline" className="text-muted-foreground">Not installed</Badge>}
                {a.available && !a.verified && <Badge variant="outline" className="font-normal text-muted-foreground" title="Flags come from the project’s docs and have not been run on this computer yet">Unverified</Badge>}
              </ItemTitle>
              {a.available && <ItemDescription className="font-mono text-xs break-all">{a.version} at {a.path}</ItemDescription>}
              <ItemDescription className="text-xs">Talks over <span className="font-mono">{a.protocol}</span>{a.gateways?.length ? `. Can use ${a.gateways.join(', ')} gateways.` : '.'}</ItemDescription>
              {a.note && <ItemDescription className="text-xs text-warning">{a.note}</ItemDescription>}
            </ItemContent>
          </Item>
        ))}
      </div>
      {s.project && (
        <Item variant="muted">
          <ItemMedia variant="icon"><BookOpen /></ItemMedia>
          <ItemContent><ItemTitle>Share project instructions</ItemTitle><ItemDescription>Creates AGENTS.md, plus CLAUDE.md and GEMINI.md files that import it, so every agent follows the same rules in this project.</ItemDescription></ItemContent>
          <ItemActions><Button size="sm" variant="outline" onClick={async () => { const c = await s.hub.call<string[]>('syncInstructions', s.project); toast.success(c.length ? `Created ${c.join(', ')}` : 'Already shared'); }}>Share</Button></ItemActions>
        </Item>
      )}
    </Section>
  );
}

const PROTOCOLS: { id: Protocol; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic Messages, for Claude Code' },
  { id: 'openai', label: 'OpenAI compatible, for Codex, OpenCode and Aider' },
  { id: 'gemini', label: 'Gemini API, for Gemini CLI and Antigravity' },
  { id: 'ollama', label: 'Ollama through Codex local mode' },
  { id: 'lmstudio', label: 'LM Studio through Codex local mode' },
];

function GatewaysTab() {
  const s = useStore(); const [form, setForm] = React.useState<Partial<Gateway> | null>(null);
  const gws = s.st?.gateways ?? [];
  const save = async () => {
    if (!form?.name?.trim()) return toast.error('Give the gateway a name');
    if (!['ollama', 'lmstudio', 'gemini'].includes(form.protocol!) && !/^https?:\/\//.test(form.baseUrl || '')) return toast.error('Base URL must start with http:// or https://');
    await s.hub.call('saveGateway', form); setForm(null); await s.refreshState(); toast.success('Gateway saved');
  };
  return (
    <Section title="Model gateways" description="Point an agent at a local or third-party model endpoint, such as LiteLLM, Ollama, LM Studio, DeepSeek or OpenRouter. Pick a gateway from the agent menu in the message box. API keys are encrypted with the system keychain when one is available and never written to Tributary’s data file."
      actions={!form && <Button size="sm" onClick={() => setForm({ protocol: 'openai', wireApi: 'chat' })}><Plus /> Add gateway</Button>}>
      {form && (
        <div className="rounded-xl border p-4">
          <FieldGroup>
            {!form.id && (
              <Field><FieldLabel htmlFor="gw-preset">Start from a preset</FieldLabel>
                <NativeSelect id="gw-preset" defaultValue="" onChange={(e) => { const p = s.st!.presets[Number(e.target.value)]; if (p) setForm((f) => ({ ...f, ...p })); }}>
                  <NativeSelectOption value="">Choose a preset…</NativeSelectOption>
                  {s.st!.presets.map((p, i) => <NativeSelectOption key={p.name} value={i}>{p.name}</NativeSelectOption>)}
                </NativeSelect></Field>
            )}
            <Field><FieldLabel htmlFor="gw-name">Name</FieldLabel><Input id="gw-name" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Local LiteLLM…" autoComplete="off" /></Field>
            <Field><FieldLabel htmlFor="gw-proto">API style</FieldLabel>
              <NativeSelect id="gw-proto" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as Protocol })}>{PROTOCOLS.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.label}</NativeSelectOption>)}</NativeSelect></Field>
            <Field><FieldLabel htmlFor="gw-url">Base URL</FieldLabel><Input id="gw-url" className="font-mono" value={form.baseUrl ?? ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:4000…" spellCheck={false} autoComplete="off" />
              <FieldDescription>Leave empty for Ollama or LM Studio through Codex, or for the default Gemini API.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="gw-model">Model</FieldLabel><Input id="gw-model" className="font-mono" value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="qwen3-coder…" spellCheck={false} autoComplete="off" /></Field>
            {form.protocol === 'openai' && (
              <Field><FieldLabel htmlFor="gw-wire">OpenAI wire API</FieldLabel>
                <NativeSelect id="gw-wire" value={form.wireApi ?? 'chat'} onChange={(e) => setForm({ ...form, wireApi: e.target.value as 'chat' | 'responses' })}><NativeSelectOption value="chat">Chat Completions</NativeSelectOption><NativeSelectOption value="responses">Responses</NativeSelectOption></NativeSelect></Field>
            )}
            <Field><FieldLabel htmlFor="gw-key">API key</FieldLabel><Input id="gw-key" type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.hasKey ? 'Saved. Type to replace…' : 'Optional for local gateways…'} /></Field>
            <div className="flex gap-2"><Button onClick={save}>Save gateway</Button><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button></div>
          </FieldGroup>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {gws.map((g) => {
          const users = (s.st?.agents ?? []).filter((a) => a.available && a.gateways?.includes(g.protocol));
          return (
            <Item key={g.id} variant="outline">
              <ItemMedia variant="icon"><Waypoints /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="flex flex-wrap items-center gap-2">{g.name}<Badge variant="outline" className="font-normal">{g.protocol}</Badge>{g.hasKey && <Badge variant="secondary" className="gap-1"><KeyRound className="size-3" />Key saved</Badge>}</ItemTitle>
                <ItemDescription className="truncate font-mono text-xs">{g.baseUrl || 'Built-in local provider'}{g.model ? `, model ${g.model}` : ''}</ItemDescription>
                <ItemDescription className="text-xs">{users.length ? `Usable by ${users.map((a) => a.name).join(', ')}` : 'No installed agent can use this API style'}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.name}`} onClick={() => setForm({ ...g })}><Pencil /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Delete ${g.name}`}><Trash2 /></Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {g.name}?</AlertDialogTitle><AlertDialogDescription>The gateway and its saved API key are removed. Agents go back to their own sign-in.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { await s.hub.call('deleteGateway', g.id); if (s.gatewayId === g.id) s.setGatewayId(''); await s.refreshState(); }}>Delete gateway</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                </AlertDialog>
              </ItemActions>
            </Item>
          );
        })}
        {!gws.length && !form && <Empty className="border"><EmptyHeader><EmptyTitle>No gateways yet</EmptyTitle><EmptyDescription>Agents use their own sign-in until you add one.</EmptyDescription></EmptyHeader></Empty>}
      </div>
    </Section>
  );
}

type McpRow = { agent: string; name: string; scope: string; enabled: boolean; transport: string; target: string; envKeys?: string[] };
const splitArgs = (s: string) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''));
const parsePairs = (s: string, sep: RegExp) => Object.fromEntries(s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = sep.exec(l); return m ? [l.slice(0, m.index).trim(), l.slice(m.index + m[0].length).trim()] : [l, '']; }));

function McpTab() {
  const s = useStore(); const [rows, setRows] = React.useState<McpRow[] | null>(null); const [adding, setAdding] = React.useState(false);
  const [f, setF] = React.useState({ name: '', transport: 'stdio', command: '', url: '', env: '', headers: '', agents: MCP_AGENTS });
  const capable = (s.st?.agents ?? []).filter((a) => a.available && MCP_AGENTS.includes(a.id));
  const load = React.useCallback(async () => { setRows(null); setRows(await s.hub.call<McpRow[]>('mcp', s.project)); }, [s.hub, s.project]);
  React.useEffect(() => { load().catch((e) => { toast.error(e.message); setRows([]); }); }, [load]);
  const byName = new Map<string, McpRow[]>(); for (const r of rows ?? []) byName.set(r.name, [...(byName.get(r.name) || []), r]);
  const add = async () => {
    const [command, ...args] = splitArgs(f.command);
    const server = { name: f.name.trim(), transport: f.transport, command, args, url: f.url.trim(), env: parsePairs(f.env, /=/), headers: parsePairs(f.headers, /:\s*/) };
    try {
      const res = await s.hub.call<{ agent: string; ok: boolean; message: string }[]>('addMcp', server, f.agents.filter((a) => capable.find((c) => c.id === a)));
      for (const r of res) (r.ok ? toast.success : toast.error)(`${s.agentOf(r.agent).name}: ${r.ok ? 'added' : r.message || 'failed'}`);
      if (res.some((r) => r.ok)) { setAdding(false); setF({ ...f, name: '', command: '', url: '', env: '', headers: '' }); load(); }
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Section title="MCP servers" description="Each agent keeps its own list of MCP servers. Here you can see them side by side and add a server to several agents at once. Changes go through each agent’s own mcp command, so their config files stay valid. Secret values are hidden."
      actions={<><Button variant="outline" size="sm" onClick={load}><RefreshCw /> Refresh</Button>{!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add server</Button>}</>}>
      {adding && (
        <div className="rounded-xl border p-4">
          <FieldGroup>
            <Field><FieldLabel htmlFor="mcp-name">Name</FieldLabel><Input id="mcp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="filesystem…" autoComplete="off" spellCheck={false} /></Field>
            <Field><FieldLabel htmlFor="mcp-tr">Transport</FieldLabel><NativeSelect id="mcp-tr" value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value })}><NativeSelectOption value="stdio">Local command (stdio)</NativeSelectOption><NativeSelectOption value="http">Remote URL (HTTP)</NativeSelectOption></NativeSelect></Field>
            {f.transport === 'stdio'
              ? <Field><FieldLabel htmlFor="mcp-cmd">Command</FieldLabel><Input id="mcp-cmd" className="font-mono" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-filesystem /path…" spellCheck={false} autoComplete="off" /></Field>
              : <Field><FieldLabel htmlFor="mcp-url">URL</FieldLabel><Input id="mcp-url" className="font-mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/mcp…" spellCheck={false} autoComplete="off" /></Field>}
            <Field><FieldLabel htmlFor="mcp-env">Environment variables</FieldLabel><Textarea id="mcp-env" className="font-mono text-xs" rows={2} value={f.env} onChange={(e) => setF({ ...f, env: e.target.value })} placeholder="API_TOKEN=…" spellCheck={false} /><FieldDescription>One KEY=value per line.</FieldDescription></Field>
            {f.transport === 'http' && <Field><FieldLabel htmlFor="mcp-h">Headers</FieldLabel><Textarea id="mcp-h" className="font-mono text-xs" rows={2} value={f.headers} onChange={(e) => setF({ ...f, headers: e.target.value })} placeholder="Authorization: Bearer …" spellCheck={false} /><FieldDescription>One Name: value per line. Codex only supports a bearer token variable, so it is skipped when headers are set.</FieldDescription></Field>}
            <Field><FieldLabel>Add to</FieldLabel>
              <div className="flex flex-wrap gap-3">{capable.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm"><Switch checked={f.agents.includes(a.id)} onCheckedChange={(v) => setF({ ...f, agents: v ? [...f.agents, a.id] : f.agents.filter((x) => x !== a.id) })} /><AgentAvatar agent={a} size="xs" />{a.name}</label>
              ))}</div></Field>
            <div className="flex gap-2"><Button onClick={add} disabled={!f.name.trim() || !(f.transport === 'stdio' ? f.command.trim() : f.url.trim())}>Add server</Button><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button></div>
          </FieldGroup>
        </div>
      )}
      {rows == null ? <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div> : (
        <div className="flex flex-col gap-2">
          {[...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => (
            <Item key={name} variant="outline" className="items-start">
              <ItemMedia variant="icon"><Plug /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="flex flex-wrap items-center gap-2">{name}<Badge variant="outline" className="font-normal">{list[0].transport}</Badge>{list.some((r) => !r.enabled) && <Badge variant="secondary">Disabled somewhere</Badge>}</ItemTitle>
                <ItemDescription className="truncate font-mono text-xs" title={list[0].target}>{list[0].target}</ItemDescription>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.map((r) => (
                    <span key={`${r.agent}-${r.scope}`} className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-0.5 text-xs">
                      <AgentAvatar agent={s.agentOf(r.agent)} size="xs" />{s.agentOf(r.agent).name}<span className="text-muted-foreground">{r.scope}</span>
                      {r.scope === 'user' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><button className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove ${name} from ${s.agentOf(r.agent).name}`}><Trash2 className="size-3" /></button></AlertDialogTrigger>
                          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {name} from {s.agentOf(r.agent).name}?</AlertDialogTitle><AlertDialogDescription>This runs {s.agentOf(r.agent).name}’s own “mcp remove” command. Other agents keep their copy.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { const res = await s.hub.call<{ ok: boolean; message: string }>('removeMcp', r.agent, name); (res.ok ? toast.success : toast.error)(res.ok ? `Removed from ${s.agentOf(r.agent).name}` : res.message); load(); }}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                        </AlertDialog>
                      )}
                    </span>
                  ))}
                </div>
              </ItemContent>
            </Item>
          ))}
          {!byName.size && <Empty className="border"><EmptyHeader><EmptyTitle>No MCP servers found</EmptyTitle><EmptyDescription>None of the installed agents has an MCP server configured.</EmptyDescription></EmptyHeader></Empty>}
        </div>
      )}
    </Section>
  );
}

type Skill = { name: string; title: string; description: string; agents: string[] };
function SkillsTab() {
  const s = useStore(); const [list, setList] = React.useState<Skill[] | null>(null); const [q, setQ] = React.useState('');
  const load = React.useCallback(async () => setList(await s.hub.call<Skill[]>('skills', s.project)), [s.hub, s.project]);
  React.useEffect(() => { load().catch(() => setList([])); }, [load]);
  const all = ['antigravity', 'claude', 'codex', 'gemini'].filter((id) => s.agentOf(id).available);
  const shown = (list ?? []).filter((k) => !q || `${k.name} ${k.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title="Skills" description="Skills are folders of instructions agents load when a task calls for them. Each agent has its own skills folder; this list merges them. Sharing links a skill into every agent’s folder without copying or overwriting anything.">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${list?.length ?? ''} skills…`} aria-label="Search skills" />
      {list == null ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : (
        <div className="flex flex-col gap-2">
          {shown.slice(0, 200).map((k) => {
            const missing = all.filter((id) => !k.agents.includes(id));
            return (
              <Item key={k.name} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="font-mono text-[13px]">{k.name}</ItemTitle>
                  {k.description && <ItemDescription className="line-clamp-2 text-xs">{k.description}</ItemDescription>}
                </ItemContent>
                <ItemActions className="shrink-0">
                  <span className="flex -space-x-1" title={`Available to ${k.agents.map((a) => s.agentOf(a).name).join(', ')}`}>{k.agents.filter((a) => s.agentOf(a).available).map((a) => <AgentAvatar key={a} agent={s.agentOf(a)} size="xs" className="ring-2 ring-background" />)}</span>
                  {missing.length > 0 && (
                    <Button size="xs" variant="outline" onClick={async () => { try { const c = await s.hub.call<string[]>('shareSkill', k.name, s.project); toast.success(c.length ? `Shared ${k.name} with every agent` : 'Already shared'); load(); } catch (e) { toast.error((e as Error).message); } }}><Share2 /> Share with all</Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => { s.setDraft(`Use the ${k.name} skill. ${s.draft}`); s.setSettings({ ...s.settings, open: false }); }}>Use</Button>
                </ItemActions>
              </Item>
            );
          })}
          {!shown.length && <Empty className="border"><EmptyHeader><EmptyTitle>{q ? 'No skills match' : 'No skills found'}</EmptyTitle></EmptyHeader></Empty>}
        </div>
      )}
    </Section>
  );
}

function AppearanceTab() {
  const s = useStore();
  if (s.hub.platform === 'vscode') return <Section title="Appearance" description="Inside VS Code, Tributary follows your editor theme."><span /></Section>;
  const opts: { id: Theme; label: string; icon: React.ReactNode }[] = [{ id: 'system', label: 'Match system', icon: <Monitor /> }, { id: 'light', label: 'Light', icon: <Sun /> }, { id: 'dark', label: 'Dark', icon: <Moon /> }];
  return (
    <Section title="Appearance" description="Choose how Tributary looks.">
      <FieldGroup className="max-w-md">
        <Field><FieldLabel htmlFor="interface-font">Interface font</FieldLabel>
          <NativeSelect id="interface-font" value={s.interfaceFont} onChange={(e) => s.setInterfaceFont(e.target.value as InterfaceFont)}>
            <NativeSelectOption value="geist">Geist — clean and compact</NativeSelectOption><NativeSelectOption value="plex">IBM Plex Sans — familiar and open</NativeSelectOption><NativeSelectOption value="system">System font</NativeSelectOption>
          </NativeSelect><FieldDescription>Fonts are included in the app. Code keeps its own monospaced font.</FieldDescription>
        </Field>
        <Field><FieldLabel htmlFor="reading-size">Response text size</FieldLabel>
          <NativeSelect id="reading-size" value={s.readingSize} onChange={(e) => s.setReadingSize(Number(e.target.value))}>{[14, 15, 16, 18, 20].map((n) => <NativeSelectOption key={n} value={n}>{n} px</NativeSelectOption>)}</NativeSelect>
        </Field>
        <div className="rounded-lg border bg-card px-4 py-3"><p className="mb-1 text-sm font-semibold">A clearer space to work together</p><p className="prose-reply text-muted-foreground">Keep your tasks, decisions and progress in one place.</p></div>
      </FieldGroup>
      <ToggleGroup type="single" variant="outline" spacing={2} value={s.theme} onValueChange={(v) => { if (v) s.setTheme(v as Theme); }} aria-label="Theme" className="grid w-full max-w-md grid-cols-3">
        {opts.map((o) => (
          <ToggleGroupItem key={o.id} value={o.id} className="h-auto flex-col gap-2 rounded-xl p-4 text-sm text-foreground [&_svg:not([class*='size-'])]:size-5 data-[state=on]:border-brand data-[state=on]:bg-transparent data-[state=on]:ring-1 data-[state=on]:ring-brand">{o.icon}{o.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Section>
  );
}

function AboutTab() {
  const s = useStore();
  return (
    <Section title="About Tributary">
      <div className="flex items-center gap-4"><img src="./logo.svg" alt="" className="size-14 rounded-2xl" /><div><div className="text-lg font-semibold">Tributary 0.1.0</div><div className="text-sm text-muted-foreground">Every coding agent, one stream of work.</div></div></div>
      <p className="max-w-prose text-sm text-muted-foreground">Tributary runs the coding agents you already have through their official headless and protocol modes. When you switch agents mid-thread, the next one gets a compact summary of the conversation and the git working tree, so no agent starts from zero. Before each turn that may edit files, Tributary saves a git checkpoint you can restore.</p>
      <p className="text-sm text-muted-foreground">Custom agents: <span className="font-mono text-xs break-all">{s.st?.customAgentsFile}</span></p>
    </Section>
  );
}

export function SettingsDialog() {
  const s = useStore(); const [query, setQuery] = React.useState('');
  const keywords: Record<string, string> = { connections: 'assistant provider local model account', agents: 'coding install custom', gateways: 'model endpoint api', mcp: 'tools servers', skills: 'instructions extensions', appearance: 'font typography reading size theme dark light system', about: 'version information' };
  const matches = NAV.filter((n) => `${n.label} ${keywords[n.id] || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const tab = query.trim() ? (matches.find((n) => n.id === s.settings.tab)?.id || matches[0]?.id) : s.settings.tab;
  return (
    <Dialog open={s.settings.open} onOpenChange={(open) => s.setSettings({ ...s.settings, open })}>
      <DialogContent className="flex h-[min(720px,90vh)] w-[min(980px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none md:flex-row">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Agents, model gateways, MCP servers, skills and appearance</DialogDescription>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-sidebar p-2 md:w-52 md:flex-col md:border-r md:border-b-0 md:p-3">
          <div className="hidden px-2 pt-1 pb-3 font-semibold md:block">Settings</div>
          {matches.map((n) => (
            <button key={n.id} onClick={() => s.setSettings({ open: true, tab: n.id })} aria-current={tab === n.id ? 'page' : undefined}
              className={cn('flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4', tab === n.id && 'bg-sidebar-accent font-medium text-foreground')}>{n.icon}{n.label}</button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a settings section…" aria-label="Find a settings section" className="mb-6" />
          {!tab && <p className="text-sm text-muted-foreground">No settings match “{query}”. Try font, appearance, agents or connections.</p>}
          {tab === 'connections' && <Connections />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'gateways' && <GatewaysTab />}
          {tab === 'mcp' && <McpTab />}
          {tab === 'skills' && <SkillsTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
