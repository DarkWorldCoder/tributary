import * as React from 'react';
import { Download, Eye, FileText, PencilLine, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Markdown } from '@/components/markdown';
import { useStore } from '@/store';
import { documentDirty, retainDocumentDrafts } from '@/lib/document-cache.mjs';
import type { SavedDocument } from '@/types';

type Entry = { saved: SavedDocument; title: string; content: string };

export function DocumentPanel() {
  const s = useStore(); const selection = s.document;
  const key = selection ? `${selection.threadId}:${selection.id}` : '';
  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [discard, setDiscard] = React.useState(false);
  const entry = entries[key];
  const dirty = documentDirty(entry);
  React.useEffect(() => { setEntries((all) => retainDocumentDrafts(all, key)); }, [key, entries]);
  React.useEffect(() => {
    if (!selection) return;
    let active = true; setError(''); setStatus('');
    s.hub.call<SavedDocument>('document', selection.threadId, selection.id).then((doc) => {
      if (active) setEntries((all) => all[key] ? all : { ...all, [key]: { saved: doc, title: doc.title, content: doc.content } });
    }).catch((e) => { if (active) setError(e.message || String(e)); });
    return () => { active = false; };
  }, [key, selection?.threadId, selection?.id, s.hub]);
  if (!selection) return null;
  const edit = (patch: Partial<Entry>) => setEntries((all) => ({ ...all, [key]: { ...all[key], ...patch } }));
  const save = async () => {
    if (!entry) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const doc = await s.hub.call<SavedDocument>('saveDocument', selection.threadId, selection.id, { title: entry.title, content: entry.content, expectedRevision: entry.saved.revision });
      setEntries((all) => ({ ...all, [key]: { saved: doc, title: doc.title, content: doc.content } }));
      s.setThread((t) => t?.id === selection.threadId ? { ...t, documents: [...(t.documents || []).filter((d) => d.id !== doc.id), doc] } : t);
      setStatus(`Version ${doc.revision} saved on this device.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const exportDoc = async (format: string) => {
    setBusy(true); setError(''); setStatus('');
    try { const result = await s.hub.call<string | null>('exportDocument', selection.threadId, selection.id, format); if (result) setStatus(`Exported to ${result}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const close = () => { if (dirty) setDiscard(true); else s.setDocument(null); };
  return (
    <aside aria-label="Saved document" className="flex w-[min(520px,44vw)] shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-full">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4"><FileText className="size-4 text-brand" /><span className="flex-1 text-sm font-semibold">Your document</span><Button variant="ghost" size="icon-sm" onClick={() => setPreview(!preview)} aria-label={preview ? 'Edit document' : 'Preview document'}>{preview ? <PencilLine /> : <Eye />}</Button><Button variant="ghost" size="icon-sm" onClick={close} disabled={busy} aria-label="Close document"><X /></Button></header>
      {entry ? <>
        <div className="space-y-3 border-b p-4"><label className="sr-only" htmlFor="document-title">Document title</label><Input id="document-title" value={entry.title} onChange={(e) => edit({ title: e.target.value })} maxLength={120} disabled={busy} /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : `Saved version ${entry.saved.revision}`}</span><button className="text-xs underline underline-offset-4" onClick={() => s.openThread(selection.threadId)}>Open conversation</button></div></div>
        {preview ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><Markdown text={entry.content} /></div> : <Textarea aria-label="Document content" value={entry.content} onChange={(e) => edit({ content: e.target.value })} maxLength={256000} disabled={busy} className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 text-sm leading-7 focus-visible:ring-inset" />}
        <footer className="space-y-3 border-t p-4">
          {!!entry.saved.history.length && <div className="flex items-center gap-2"><label className="shrink-0 text-xs text-muted-foreground" htmlFor="document-version">Earlier version</label><NativeSelect id="document-version" value="" disabled={busy} onChange={(e) => { const v = entry.saved.history.find((v) => v.revision === Number(e.target.value)); if (v) { edit({ title: v.title, content: v.content }); setStatus('Earlier version loaded as a draft. Save to make it the current version.'); } }}><NativeSelectOption value="">Choose a version</NativeSelectOption>{[...entry.saved.history].reverse().map((v) => <NativeSelectOption key={v.revision} value={v.revision}>Version {v.revision}</NativeSelectOption>)}</NativeSelect></div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {status && <p role="status" className="break-words text-xs text-muted-foreground">{status}</p>}
          <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy || !dirty || !entry.title.trim()} size="sm"><Save />{busy ? 'Working…' : 'Save changes'}</Button><Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => exportDoc('md')}><Download />Markdown</Button><Button variant="ghost" size="sm" disabled={busy || dirty} onClick={() => exportDoc('txt')}>Text</Button></div>
          <p className="text-xs text-muted-foreground">{dirty ? 'Save your changes before exporting.' : 'Saved documents remain available when you reopen this conversation.'}</p>
        </footer>
      </> : <div className="flex-1 p-5"><p role={error ? 'alert' : 'status'} className="text-sm text-muted-foreground">{error || 'Loading your saved document…'}</p></div>}
      <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>The saved version stays available. Save your changes first if you want to keep these edits.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { setEntries((all) => { const next = { ...all }; delete next[key]; return next; }); s.setDocument(null); }}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </aside>
  );
}
