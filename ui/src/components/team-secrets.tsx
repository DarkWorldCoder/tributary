import * as React from 'react';
import { Copy, KeyRound, Lock, Plus, Share2, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { useStore } from '@/store';
import type { RoomState } from '../../../core/collaboration/client.mjs';

type Member = { recipient: string; name: string; you: boolean; canRead: boolean };
type TeamStatus = { root: string; file: string; exists: boolean; names: string[]; config: 'none' | 'managed' | 'other'; members: Member[]; key: string | null; storage: 'encrypted' | 'weak' | 'session'; sops: boolean; canRead: boolean };
const short = (key: string) => `${key.slice(0, 12)}…${key.slice(-6)}`;

// Settings, Team secrets: this person's age key, the project's members and the names of its values. Values can be set
// or removed here but never come back to the window; agents and terminals get them as environment variables.
export function TeamSecrets() {
  const s = useStore();
  const project = s.project && s.st?.projects.find((p) => p.path === s.project)?.kind !== 'personal' ? s.project : null;
  const [st, setSt] = React.useState<TeamStatus | null>(null);
  const [room, setRoom] = React.useState<RoomState | null>(null);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState('');
  const [myName, setMyName] = React.useState('');
  const [adding, setAdding] = React.useState<{ name: string; recipient: string } | null>(null);
  const [value, setValue] = React.useState<{ name: string; value: string; replacing: boolean } | null>(null);
  const [rotate, setRotate] = React.useState<{ who: string; names: string[] } | null>(null);

  const load = React.useCallback(async () => {
    if (!project) { setSt(null); return; }
    try { setSt(await s.hub.call<TeamStatus>('teamSecrets', project)); } catch (e) { setError((e as Error).message); }
    s.hub.call<RoomState>('collaborationState').then(setRoom).catch(() => setRoom(null));
  }, [project, s.hub]);
  React.useEffect(() => { setError(''); setNotice(''); setRotate(null); load(); }, [load]);
  const act = async (work: () => Promise<unknown>, done?: string) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await work(); if (done) setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!project) return <Section><p className="text-sm text-muted-foreground">Open a project folder to share its secrets with your team.</p></Section>;
  const roomProject = room?.snapshot?.project.name;
  const known = new Set(st?.members.map((m) => m.recipient));
  const fromRoom = (room?.snapshot?.members ?? []).filter((m) => m.ageKey && !known.has(m.ageKey));
  const managed = st?.config === 'managed';
  return (
    <Section>
      {st && !st.sops && <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">SOPS is not installed, so this computer can’t read or change team secrets. Install it from <a className="underline" href="https://getsops.io/docs/" target="_blank" rel="noreferrer">getsops.io</a> (for example <code>brew install sops</code>).</p>}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Your key</h3>
        {st?.key ? <Item variant="outline">
          <ItemMedia variant="icon"><KeyRound /></ItemMedia>
          <ItemContent className="min-w-0"><ItemTitle className="break-all font-mono text-xs">{st.key}</ItemTitle>
            <ItemDescription className="text-xs">The public half. Teammates add it so files are encrypted to you; the private half stays in this computer’s credential storage.</ItemDescription></ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => act(() => navigator.clipboard.writeText(st.key!), 'Your public key is copied.')}><Copy /> Copy</Button>
            {roomProject && room?.snapshot?.members.find((m) => m.id === room.user?.id)?.ageKey !== st.key && <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => s.hub.call('collaborationCommand', 'ageKey', { recipient: st.key }), `Shared in ${roomProject}.`)}><Share2 /> Share in {roomProject}</Button>}
          </ItemActions>
        </Item> : <div className="rounded-xl border border-dashed p-4"><p className="text-sm text-muted-foreground">You need an age key to read a team’s secrets. Tributary makes one and keeps its private half in this computer’s credential storage.</p><Button className="mt-3" size="sm" disabled={busy} onClick={() => act(() => s.hub.call('createTeamKey'), 'Your key is ready. Send the public key to a member, or share it in your project room.')}><KeyRound /> Create my key</Button></div>}
        {st && st.storage !== 'encrypted' && <p className="text-xs text-warning">No system keyring is running here, so a key you create lasts only until the app closes.</p>}
      </div>

      {st?.config === 'none' && <form className="rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); act(() => s.hub.call('startTeamSecrets', project, myName), 'Team secrets started. Add teammates and values, then commit .sops.yaml and the secrets file.'); }}>
        <FieldGroup><Field><FieldLabel htmlFor="ts-me">Your name</FieldLabel><Input id="ts-me" value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={80} placeholder="Shown next to your key in .sops.yaml" autoComplete="off" />
          <FieldDescription>This project doesn’t share secrets yet. Starting writes a <code>.sops.yaml</code> that lists your key; values go to <code>{st.file}</code>, encrypted.</FieldDescription></Field>
          <div><Button type="submit" disabled={busy || !st.sops}>Start team secrets</Button></div></FieldGroup>
      </form>}
      {st?.config === 'other' && <p className="text-sm text-muted-foreground">This repository’s <code>.sops.yaml</code> wasn’t made by Tributary, so change its age keys by hand and run <code>sops updatekeys {st.file}</code>. Tributary still reads the file and sets its values.</p>}
      {st?.exists && !st.canRead && <p role="status" className="rounded-lg border p-3 text-sm">Your key can’t open this project’s secrets yet. Send your public key to a member{roomProject ? `, or share it in ${roomProject},` : ''} and ask them to add you.</p>}

      {st && st.config !== 'none' && <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Members</h3>{managed && !adding && <Button variant="ghost" size="sm" onClick={() => setAdding({ name: '', recipient: '' })}><Plus /> Add member</Button>}</div>
        {adding && <form className="rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); act(async () => { await s.hub.call('addTeamMember', project, adding); setAdding(null); }, `${adding.name || 'The new member'} can read this project’s secrets once you commit the change.`); }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="ts-name">Name</FieldLabel><Input id="ts-name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} maxLength={80} autoComplete="off" /></Field>
            <Field><FieldLabel htmlFor="ts-key">Their public key</FieldLabel><Input id="ts-key" className="font-mono" value={adding.recipient} onChange={(e) => setAdding({ ...adding, recipient: e.target.value })} placeholder="age1…" spellCheck={false} autoComplete="off" required /></Field>
            <div className="flex gap-2"><Button type="submit" disabled={busy}>Add member</Button><Button type="button" variant="outline" onClick={() => setAdding(null)}>Cancel</Button></div>
          </FieldGroup>
        </form>}
        {st.members.map((m) => <Item key={m.recipient} variant="outline" size="sm">
          <ItemContent className="min-w-0"><ItemTitle className="flex flex-wrap items-center gap-2">{m.name || 'Unnamed'}{m.you && <Badge variant="secondary">You</Badge>}{!m.canRead && <Badge variant="outline">Can’t read yet</Badge>}</ItemTitle>
            <ItemDescription className="font-mono text-xs" title={m.recipient}>{short(m.recipient)}</ItemDescription></ItemContent>
          {managed && !m.you && <ItemActions><AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Remove ${m.name || 'this member'}`}><Trash2 /></Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {m.name || 'this member'}?</AlertDialogTitle>
              <AlertDialogDescription>Their key comes off the list and the file gets a new data key, so they can’t open it from now on. They could read every value until now, and git history keeps the old encrypted file, so change those values where they were issued too.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => act(async () => { const r = await s.hub.call<{ rotate: string[] }>('removeTeamMember', project, m.recipient); setRotate({ who: m.name || 'The removed member', names: r.rotate }); })}>Remove and rotate</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog></ItemActions>}
        </Item>)}
        {managed && fromRoom.length > 0 && <div className="rounded-xl border border-dashed p-3"><p className="mb-2 text-xs text-muted-foreground">Shared their key in {roomProject}:</p>
          {fromRoom.map((m) => <div key={m.id} className="flex items-center gap-2 py-1 text-sm"><span className="min-w-0 flex-1 truncate">{m.name} <span className="font-mono text-xs text-muted-foreground">{short(m.ageKey!)}</span></span><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => s.hub.call('addTeamMember', project, { name: m.name, recipient: m.ageKey }), `${m.name} can read this project’s secrets once you commit the change.`)}><Plus /> Add</Button></div>)}
        </div>}
      </div>}

      {rotate && <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{rotate.who} can no longer open the file. {rotate.names.length ? <>Now change {rotate.names.length === 1 ? 'this value' : 'these values'} where {rotate.names.length === 1 ? 'it was' : 'they were'} issued, and save the new ones here: <span className="font-mono">{rotate.names.join(', ')}</span>.</> : null} Commit <code>.sops.yaml</code> and the secrets file.</div>}

      {st && st.config !== 'none' && <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Values</h3>{st.canRead && !value && <Button variant="ghost" size="sm" onClick={() => setValue({ name: '', value: '', replacing: false })}><Plus /> Add value</Button>}</div>
        {value && <form className="rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); act(async () => { await s.hub.call('setTeamSecret', project, value.name, value.value); setValue(null); }, `${value.name} saved, encrypted. Commit ${st.file} to share it.`); }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="ts-var">Variable name</FieldLabel><Input id="ts-var" className="font-mono" value={value.name} readOnly={value.replacing} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="STRIPE_SECRET_KEY" spellCheck={false} autoComplete="off" required /></Field>
            <Field><FieldLabel htmlFor="ts-val">Value</FieldLabel><Input id="ts-val" type="password" value={value.value} onChange={(e) => setValue({ ...value, value: e.target.value })} autoComplete="off" required />
              <FieldDescription>Write-only: Tributary never shows a saved value. Agents and terminals in this project see it as <code>${value.name || 'NAME'}</code>, and transcripts show [REDACTED].</FieldDescription></Field>
            <div className="flex gap-2"><Button type="submit" disabled={busy}>Save value</Button><Button type="button" variant="outline" onClick={() => setValue(null)}>Cancel</Button></div>
          </FieldGroup>
        </form>}
        {st.names.map((n) => <Item key={n} variant="outline" size="sm">
          <ItemMedia variant="icon"><Lock /></ItemMedia>
          <ItemContent><ItemTitle className="font-mono text-xs">{n}</ItemTitle></ItemContent>
          {st.canRead && <ItemActions>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setValue({ name: n, value: '', replacing: true })}>Replace</Button>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Remove ${n}`} onClick={() => act(() => s.hub.call('setTeamSecret', project, n, null), `${n} removed. Commit ${st.file} to share the change.`)}><Trash2 /></Button>
          </ItemActions>}
        </Item>)}
        {!st.names.length && <p className="text-sm text-muted-foreground">No values yet.</p>}
      </div>}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div><h2 className="text-lg font-semibold">Team secrets</h2>
        <p className="mt-1 max-w-prose text-sm leading-6 text-pretty text-muted-foreground">Share a project’s secrets through the repository: an encrypted file that only your teammates’ keys can open, made with SOPS and age. Agents and terminals in the project get the values as environment variables; they are never written to disk.</p></div>
      {children}
    </section>
  );
}
