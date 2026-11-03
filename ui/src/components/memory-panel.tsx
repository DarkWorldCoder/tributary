import * as React from 'react';
import { toast } from 'sonner';
import { BookOpen, Eye, Info, Pencil, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { CodeEditor } from '@/components/code-editor';
import { Markdown } from '@/components/markdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useStore } from '@/store';
import type { MemoryInfo } from '@/types';

type Match = { text: string; characters: number; omitted: number; sources: { source: string; line: number }[] };
export function MemoryPanel() {
  const s = useStore(); const [memory, setMemory] = React.useState<MemoryInfo | null>(null); const [text, setText] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState(false); const [query, setQuery] = React.useState(''); const [matches, setMatches] = React.useState<Match | null>(null);
  const [versions, setVersions] = React.useState<{ revision: string; savedAt: number }[]>([]);
  const load = React.useCallback(async () => {
    const current = await s.hub.call<MemoryInfo>('memory', s.project); setMemory(current); setText(current.memory || '');
    setVersions(await s.hub.call<typeof versions>('memoryHistory', s.project));
  }, [s.hub, s.project]);
  React.useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  const perform = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = () => perform(async () => {
    const current = await s.hub.call<MemoryInfo>('saveMemory', s.project, text, memory?.revision);
    setMemory(current); setEditing(false); setVersions(await s.hub.call<typeof versions>('memoryHistory', s.project)); toast.success('Project memory saved');
  });
  const configure = (includeInPrompts: boolean, budget: number) => perform(async () => {
    const context = await s.hub.call<NonNullable<MemoryInfo['context']>>('configureMemory', s.project, { includeInPrompts, budget });
    setMemory((m) => m ? { ...m, context } : m);
  });
  const dirty = !!memory && text !== (memory.memory || '');
  return <div className="flex h-full min-h-0 flex-col">
    <header className="workbench-toolbar workbench-toolbar-wrap flex-wrap gap-2 border-b px-3 [&_button]:h-8 [&_button_svg]:size-4 max-sm:[&_button]:h-11"><BookOpen className="size-4 shrink-0" /><h2 className="min-w-0 flex-1 text-[13px] font-semibold">Project memory</h2>{dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}{memory?.enabled && <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}>{editing ? <Eye /> : <Pencil />}{editing ? 'Read' : 'Edit'}</Button>}
      <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="xs" disabled={busy}><RefreshCw />Reload</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load the latest project memory?</AlertDialogTitle><AlertDialogDescription>{dirty ? 'Your unsaved draft will be replaced. Copy any edits you want to keep before reloading.' : 'This reads the current notes and work log from disk.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep current text</AlertDialogCancel><AlertDialogAction onClick={() => perform(load)}>Load latest</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Button size="xs" disabled={busy || !dirty} onClick={save}><Save />Save</Button>
    </header>
    {error && <p role="alert" className="shrink-0 border-b px-3 py-2 text-sm text-destructive">{error}</p>}
    {!memory ? <p role="status" className="p-4 text-sm">{error ? 'Memory could not be loaded. Use Reload to try again.' : 'Loading project memory…'}</p> : !memory.enabled ? <div className="p-5"><h3 className="font-medium text-balance">Keep useful decisions for the next assistant</h3><p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">Save project decisions and useful notes for future conversations.</p><Button className="mt-4" disabled={busy} onClick={() => perform(async () => { await s.hub.call('enableMemory', s.project); await load(); })}>Enable project memory</Button></div> : <>
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2"><Field orientation="horizontal" className="flex-1"><FieldLabel htmlFor="memory-sharing" className="text-sm">Share notes with the assistant</FieldLabel><Switch id="memory-sharing" disabled={busy} checked={memory.context?.includeInPrompts || false} onCheckedChange={(checked) => configure(checked, memory.context?.budget || 4000)} /></Field><Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="About sharing project memory"><Info /></Button></TooltipTrigger><TooltipContent className="max-w-64">When enabled, relevant notes go to your selected assistant or provider. Previous messages stay in their history.</TooltipContent></Tooltip></div>
        <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Settings & previous versions</summary><div className="mt-3 flex flex-wrap items-end gap-3 pb-2"><Field className="min-w-36 flex-1"><FieldLabel htmlFor="memory-budget">Context limit</FieldLabel><NativeSelect id="memory-budget" disabled={busy} value={memory.context?.budget || 4000} onChange={(e) => configure(memory.context?.includeInPrompts || false, Number(e.target.value))}>{[2000, 4000, 8000].map((n) => <NativeSelectOption key={n} value={n}>{n.toLocaleString()} characters</NativeSelectOption>)}</NativeSelect></Field>
          {versions.length > 0 && <Field className="min-w-36 flex-1"><FieldLabel htmlFor="memory-version">Previous version</FieldLabel><NativeSelect id="memory-version" value="" disabled={busy || dirty} onChange={(e) => perform(async () => { setText(await s.hub.call<string>('memoryVersion', s.project, e.target.value)); setEditing(true); toast.success('Version loaded as a draft. Save to restore it.'); })}><NativeSelectOption value="" disabled>Choose a version…</NativeSelectOption>{versions.map((v) => <NativeSelectOption key={v.revision} value={v.revision}>{new Date(v.savedAt).toLocaleString()}</NativeSelectOption>)}</NativeSelect></Field>}
        </div><p className="pb-2 leading-5">Sharing is off by default. Turning it off stops future additions; it cannot erase past requests or prevent permitted file reads.</p></details>
      </div>
      <div className="min-h-32 flex-1 border-b">{editing ? <CodeEditor path=".tributary/memory.md" value={text} onChange={setText} onSave={save} /> : <div role="region" aria-label="Project notes" tabIndex={0} className="h-full overflow-auto px-5 py-4"><Markdown text={text.replace(/^# Project memory\s*\n/i, '')} /></div>}</div>
      <div className="max-h-[35%] shrink-0 overflow-auto p-3"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); perform(async () => setMatches(await s.hub.call<Match>('searchMemory', s.project, query))); }}><Input aria-label="Search saved project notes" placeholder="Search saved notes…" value={query} onChange={(e) => setQuery(e.target.value)} /><Button size="sm" variant="outline" disabled={busy}>Search</Button></form>
        {matches && <div className="mt-3"><p className="text-xs text-muted-foreground">Preview of saved context: {matches.characters.toLocaleString()} characters; {matches.omitted} lines omitted.</p><pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{matches.text || 'No saved notes yet.'}</pre></div>}
        <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Recent activity ({memory.worklog.length})</summary><ul className="space-y-2 text-xs text-muted-foreground">{[...memory.worklog].reverse().map((line, i) => <li key={i}>{line.replace(/^- /, '')}</li>)}{!memory.worklog.length && <li>Completed agent turns appear here.</li>}</ul></details>
      </div>
    </>}
  </div>;
}
