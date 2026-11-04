import * as React from 'react';
import { toast } from 'sonner';
import { BookOpen, Eye, History, ListChecks, Pencil, Plus, RefreshCw, Save, Search, Terminal, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { DeferredCodeEditor as CodeEditor } from '@/components/deferred-code-editor';
import { Markdown } from '@/components/markdown';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useStore } from '@/store';
import type { MemoryInfo } from '@/types';

type Match = { budget: number; text: string; characters: number; omitted: number; sources: { source: string; line: number }[] };
export function MemoryPanel() {
  const s = useStore(); const [memory, setMemory] = React.useState<MemoryInfo | null>(null); const [text, setText] = React.useState('');
  const [tab, setTab] = React.useState('notes');
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
  const hasNotes = text.split('\n').some((line) => line.trim() && !/^#/.test(line) && line.trim() !== 'Facts and decisions every agent should know. Keep each item to one line.');
  const edit = () => { setTab('notes'); setEditing(true); };
  const search = () => perform(async () => setMatches(await s.hub.call<Match>('searchMemory', s.project, query || s.draft)));
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <BookOpen className="size-4 shrink-0 text-brand" /><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-balance">Project memory</h2><p className="truncate text-xs text-muted-foreground">{s.st?.projects.find((project) => project.path === s.project)?.name || 'This project'} · Notes for your agents</p></div>
      {dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}
      {memory?.enabled && <Button size="xs" variant="outline" onClick={() => { setTab('notes'); setEditing(!editing); }}>{editing ? <Eye /> : <Pencil />}{editing ? 'Read' : 'Edit notes'}</Button>}
      <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Reload project memory" disabled={busy}><RefreshCw /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load the latest project memory?</AlertDialogTitle><AlertDialogDescription>{dirty ? 'Your unsaved draft will be replaced. Copy any edits you want to keep before reloading.' : 'This reads the current notes and work log from disk.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep current text</AlertDialogCancel><AlertDialogAction onClick={() => perform(load)}>Load latest</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {dirty && <Button size="xs" disabled={busy} onClick={save}><Save />Save notes</Button>}
    </header>
    {error && <p role="alert" className="shrink-0 border-b px-4 py-2 text-sm text-destructive">{error}</p>}
    {!memory ? <p role="status" className="p-5 text-sm text-muted-foreground">{error ? 'Memory could not be loaded. Use Reload to try again.' : 'Loading project memory…'}</p> : !memory.enabled ? <div className="mx-auto w-full max-w-2xl p-6"><BookOpen className="mb-4 size-8 text-brand" /><h3 className="text-lg font-medium text-balance">A shared notebook for your project</h3><p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">Keep decisions, test commands and useful context for the next agent.</p><Button className="mt-5" disabled={busy} onClick={() => perform(async () => { await s.hub.call('enableMemory', s.project); await load(); })}>Enable project memory</Button></div> : <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2.5">
        <div className="flex items-center gap-2"><Switch id="memory-sharing" disabled={busy} checked={memory.context?.includeInPrompts || false} onCheckedChange={(checked) => configure(checked, memory.context?.budget || 4000)} /><label htmlFor="memory-sharing" className="text-xs">Include relevant notes in requests</label></div>
        <div className="flex items-center gap-2"><label htmlFor="memory-context-size" className="text-xs text-muted-foreground">Budget</label><NativeSelect id="memory-context-size" className="w-auto" disabled={busy} value={memory.context?.budget || 4000} onChange={(e) => configure(memory.context?.includeInPrompts || false, Number(e.target.value))}>{[[2000, 'Compact'], [4000, 'Balanced'], [8000, 'Detailed']].map(([n, label]) => <NativeSelectOption key={n} value={n}>{label} · {Number(n).toLocaleString()} characters</NativeSelectOption>)}</NativeSelect></div>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" aria-label="Project memory views" className="shrink-0 justify-start gap-3 border-b px-4"><TabsTrigger value="notes"><BookOpen />Notes</TabsTrigger><TabsTrigger value="context"><Search />Context preview</TabsTrigger><TabsTrigger value="activity"><History />Activity <span className="text-xs tabular-nums text-muted-foreground">{memory.worklog.length}</span></TabsTrigger></TabsList>
        <TabsContent value="notes" className="min-h-0 flex-1">
          {editing ? <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground"><span>.tributary/memory.md</span><span>{text.length.toLocaleString()} characters</span></div><div className="min-h-0 flex-1"><CodeEditor path=".tributary/memory.md" value={text} onChange={setText} onSave={save} /></div></div> : <div role="region" aria-label="Project notes" tabIndex={0} className="h-full overflow-auto"><div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
            {hasNotes ? <Markdown text={text.replace(/^# Project memory\s*\n/i, '')} /> : <><h3 className="text-lg font-semibold text-balance">What should your agents remember?</h3><p className="mt-2 max-w-prose text-sm leading-6 text-pretty text-muted-foreground">Add the details you explain more than once.</p><div className="mt-5 divide-y rounded-lg border">{[{ title: 'Decisions', hint: 'Architecture, conventions and choices to keep.', icon: ListChecks }, { title: 'Run & test', hint: 'Setup steps, commands and checks that work.', icon: Terminal }, { title: 'Gotchas', hint: 'Known issues and things to avoid.', icon: TriangleAlert }].map(({ title, hint, icon: Icon }) => <button key={title} onClick={edit} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{hint}</span></span><Plus className="size-4 text-muted-foreground" /></button>)}</div><Button className="mt-5" size="sm" onClick={edit}><Plus />Add your first note</Button></>}
            <p className="mt-6 text-xs text-muted-foreground">Saved in .tributary/memory.md · Original notes stay on disk.</p>
            {versions.length > 0 && <Field className="mt-5 max-w-sm"><FieldLabel htmlFor="memory-version" className="text-xs">Restore a previous version</FieldLabel><NativeSelect id="memory-version" value="" disabled={busy || dirty} onChange={(e) => perform(async () => { setText(await s.hub.call<string>('memoryVersion', s.project, e.target.value)); edit(); toast.success('Version loaded as a draft. Save to restore it.'); })}><NativeSelectOption value="" disabled>Choose a version…</NativeSelectOption>{versions.map((v) => <NativeSelectOption key={v.revision} value={v.revision}>{new Date(v.savedAt).toLocaleString()}</NativeSelectOption>)}</NativeSelect></Field>}
          </div></div>}
        </TabsContent>
        <TabsContent value="context" className="min-h-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8"><h3 className="text-base font-semibold text-balance">See what an agent receives</h3><p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">Try a task or topic. Only relevant excerpts fit within the budget; local compact profiles may use less.</p><form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}><Input aria-label="Search saved project notes" placeholder="For example: run the tests" className="min-w-40 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} /><Button size="sm" variant="outline" disabled={busy}><Search />Preview context</Button></form>
          {matches && <div className="mt-5 overflow-hidden rounded-lg border"><div className="border-b bg-muted/30 px-4 py-2 text-xs tabular-nums text-muted-foreground">{matches.characters.toLocaleString()} / {matches.budget.toLocaleString()} characters · {matches.sources.length} sources</div><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6">{matches.text || 'No matching notes. Add a note or try another topic.'}</pre></div>}
        </div></TabsContent>
        <TabsContent value="activity" className="min-h-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8"><h3 className="text-base font-semibold text-balance">Recent project work</h3><ul className="mt-4 divide-y rounded-lg border">{[...memory.worklog].reverse().map((line, i) => <li key={i} className="px-4 py-3 text-sm leading-6 text-muted-foreground">{line.replace(/^- /, '')}</li>)}{!memory.worklog.length && <li className="px-4 py-6 text-sm text-muted-foreground">Completed agent turns will appear here.</li>}</ul></div></TabsContent>
      </Tabs>
    </>}
  </div>;
}
