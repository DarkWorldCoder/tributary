import * as React from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, FileText, FolderOpen, ListChecks, Paperclip, PenLine, Plug, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { TaskTemplate } from '@/types';

const GROUPS = ['Write', 'Understand', 'Learn', 'Organize'];
const ICONS = { Write: PenLine, Understand: Search, Learn: BookOpen, Organize: ListChecks };

export function TaskHome() {
  const s = useStore();
  const [group, setGroup] = React.useState('Write');
  const [selected, setSelected] = React.useState<TaskTemplate | null>(null);
  const [goal, setGoal] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [material, setMaterial] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const templates = s.st?.taskTemplates ?? [];
  const current = s.ready.find((a) => a.id === s.agentId) || s.ready[0];
  const choose = (t: TaskTemplate) => { setSelected(t); setGoal(''); setAudience(''); setMaterial(''); setError(''); };
  const addFiles = async (files: FileList | File[]) => {
    if (importing) return;
    setImporting(true); setError('');
    try {
      const additions = [];
      for (const file of Array.from(files)) {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('Attach a text or Markdown file, or paste text from another document.');
        if (file.size > 160000) throw new Error(`${file.name} is too large. Paste the relevant section instead.`);
        const content = await file.text();
        if (content.includes('\0')) throw new Error(`${file.name} is not a readable text file.`);
        additions.push(`Source: ${file.name}\n${content}`);
      }
      const next = [material, ...additions].filter(Boolean).join('\n\n---\n\n');
      if (next.length > 40000) throw new Error('Use up to 40,000 characters of material. Remove some text before attaching these files.');
      setMaterial(next);
    } catch (e) { setError((e as Error).message); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!current) { s.openSettings('connections'); return; }
    setBusy(true); setError('');
    try { await s.startTask({ templateId: selected.id, goal, audience, material }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const openFolder = async () => {
    try {
      const p = await s.hub.call<string | null>('pickProject');
      if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); }
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8">
          <h2 className="text-3xl font-semibold text-balance">What would you like to get done?</h2>
          <p className="mt-3 max-w-xl text-base text-pretty text-muted-foreground">Bring an idea or some text. Work through it, shape the result, and keep it for later.</p>
        </header>
        {!selected ? (
          <>
            <div className="mb-3 flex flex-wrap gap-1 border-b pb-3" aria-label="Task categories">
              {GROUPS.map((g) => { const Icon = ICONS[g as keyof typeof ICONS]; return (
                <Button key={g} variant={group === g ? 'secondary' : 'ghost'} onClick={() => setGroup(g)} aria-pressed={group === g}><Icon />{g}</Button>
              ); })}
            </div>
            <div className="grid gap-x-7 sm:grid-cols-2">
              {templates.filter((t) => t.group === group).map((t) => (
                <button key={t.id} onClick={() => choose(t)} className="group flex min-h-28 items-start gap-3 border-b px-1 py-5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  <FileText className="mt-1 size-5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{t.title}</span><span className="mt-1 block text-sm text-pretty text-muted-foreground">{t.description}</span></span>
                  <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
              ))}
            </div>
            {!templates.length && <p className="py-6 text-sm text-muted-foreground">Task templates are not available in this host yet. You can still open a project below.</p>}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/50 px-4 py-4">
              <div><p className="text-sm font-medium">{current ? `${s.ready.length} assistant${s.ready.length === 1 ? '' : 's'} available` : 'Start with an assistant connection'}</p><p className="mt-1 text-xs text-muted-foreground">{current ? 'Choose a task to begin. You can change assistants as you work.' : 'Use a local model service, a compatible provider, or an installed assistant.'}</p></div>
              <Button variant="outline" onClick={() => s.openSettings('connections')}><Plug />{current ? 'Connections' : 'Connect an assistant'}</Button>
            </div>
            <div className="mt-7 flex items-center gap-3 border-t pt-5 text-sm text-muted-foreground"><FolderOpen className="size-4" /><span className="flex-1">Working with a project folder?</span><Button variant="ghost" size="sm" onClick={openFolder}>Open folder</Button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="mb-6 flex items-center gap-3"><Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelected(null)} aria-label="Back to tasks"><ArrowLeft /></Button><div><h3 className="text-xl font-semibold">{selected.title}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.description}</p></div></div>
            <FieldGroup>
              <Field><FieldLabel htmlFor="task-goal">What do you want to achieve?</FieldLabel><Textarea id="task-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} placeholder={selected.id === 'translate' ? 'Translate this into Spanish for a customer…' : 'Describe the result you need…'} required className="min-h-24" /></Field>
              <Field><FieldLabel htmlFor="task-audience">Who is this for? <span className="font-normal text-muted-foreground">Optional</span></FieldLabel><Input id="task-audience" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} placeholder="My team, a client, or myself…" /></Field>
              <Field onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
                <div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="task-material">Your material {!selected.needsMaterial && <span className="font-normal text-muted-foreground">Optional</span>}</FieldLabel><Button type="button" variant="ghost" size="sm" disabled={importing} onClick={() => fileInput.current?.click()}><Paperclip />{importing ? 'Reading…' : 'Attach text'}</Button></div>
                <input ref={fileInput} type="file" accept=".txt,.md,.markdown" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); }} />
                <Textarea id="task-material" value={material} onChange={(e) => setMaterial(e.target.value)} maxLength={40000} required={!!selected.needsMaterial} placeholder="Paste notes or source text here. For comparisons, label each source." className="min-h-40 max-h-96" />
                <FieldDescription>Paste text or drop .txt and .md files. {material.length.toLocaleString()} / 40,000 characters.</FieldDescription>
              </Field>
              {current && <Field><FieldLabel htmlFor="task-assistant">Assistant</FieldLabel><NativeSelect id="task-assistant" value={current.id} onChange={(e) => s.setAgentId(e.target.value)}>{s.ready.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect><FieldDescription>{current.connectionId ? 'Only this request and its conversation summary are sent to your chosen service. This connection cannot change files or send messages.' : 'This task runs in read-only mode with your installed assistant. It receives the text you provide.'}</FieldDescription></Field>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy || importing} className={cn('min-w-32')}><PenLine />{busy ? 'Starting…' : current ? 'Start task' : 'Connect an assistant'}</Button><p className="max-w-sm text-xs text-muted-foreground">{current?.connectionId ? 'Your provider’s usage charges and limits apply.' : 'Your assistant’s usage charges and limits apply.'} Review generated details before using them.</p></div>
            </FieldGroup>
          </form>
        )}
        {!selected && error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
