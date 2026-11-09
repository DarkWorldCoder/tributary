import * as React from 'react';
import { RefreshCw, Undo2, WandSparkles } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileDiff } from '@/components/file-diff';

type Row = { rel: string; status: string; message?: string };
type Preview = { token: string; rows: Row[]; limited: boolean; scanned: number };
type Applied = { rows: Row[]; undoable: string[] };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; project: string; getUnsaved: () => string[]; onApplied: () => void };
export function FormatProjectDialog(props: Props) {
  // The portal owns preview state, so closing releases it after Radix's exit/focus cleanup.
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-6xl">
    <FormatProjectContent key={props.project} {...props} />
  </DialogContent></Dialog>;
}
function FormatProjectContent({ open, onOpenChange, project, getUnsaved, onApplied }: Props) {
  const s = useStore(); const callbacks = React.useRef({ getUnsaved, onApplied }); callbacks.current = { getUnsaved, onApplied };
  const generation = React.useRef(0); const [preview, setPreview] = React.useState<Preview | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]); const [active, setActive] = React.useState(''); const [diff, setDiff] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(''); const [applied, setApplied] = React.useState<Applied | null>(null);
  const scan = React.useCallback(async () => {
    const id = ++generation.current; setBusy(true); setError(''); setPreview(null); setApplied(null); setDiff(null); setActive('');
    try {
      const result = await s.hub.call<Preview>('previewFormat', project, callbacks.current.getUnsaved());
      if (id !== generation.current) return;
      setPreview(result); const files = result.rows.filter((row) => row.status === 'changed').map((row) => row.rel); setSelected(files); setActive(files[0] || '');
    } catch (error) { if (id === generation.current) setError((error as Error).message); }
    finally { if (id === generation.current) setBusy(false); }
  }, [s.hub, project]);
  React.useEffect(() => { if (open) void scan(); return () => { generation.current++; }; }, [open, scan]);
  React.useEffect(() => {
    if (!open || !preview || !active) return; let alive = true; setDiff(null);
    s.hub.call<string>('formatDiff', project, preview.token, active).then((value) => { if (alive) setDiff(value); }).catch((error) => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [open, preview, active, project, s.hub]);
  const apply = async (undo = false) => {
    if (!preview || busy) return; setBusy(true); setError('');
    const id = generation.current; const didApply = callbacks.current.onApplied;
    try {
      const result = await s.hub.call<Applied>('applyFormat', project, preview.token, undo ? applied?.undoable || [] : selected, callbacks.current.getUnsaved(), undo);
      // An admitted write still refreshes its original project if this dialog closes or changes.
      didApply();
      if (id === generation.current) { setApplied(result); setSelected([]); }
    } catch (error) { if (id === generation.current) setError((error as Error).message); }
    finally { if (id === generation.current) setBusy(false); }
  };
  const changed = preview?.rows.filter((row) => row.status === 'changed') || [];
  const unchanged = preview?.rows.filter((row) => row.status === 'unchanged').length || 0;
  const skipped = preview?.rows.filter((row) => !['changed', 'unchanged'].includes(row.status)) || [];
  return <>
    <DialogHeader><DialogTitle>Format all files</DialogTitle><DialogDescription className="break-all">{project}</DialogDescription></DialogHeader>
    <p className="text-xs text-muted-foreground">Uses project formatting rules. Unsaved, ignored and generated files are skipped. Review before applying.</p>
    {error && <p role="alert" className="text-[13px] text-destructive">{error.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}</p>}
    {busy && !preview && <p role="status" className="py-10 text-center text-sm text-muted-foreground">Checking formatting…</p>}
    {preview && <>
      <p role="status" className="text-[13px] tabular-nums">{changed.length} need formatting · {unchanged} unchanged · {skipped.length} skipped or unavailable</p>
      {preview.limited && <p className="text-xs text-warning">Preview limited to 400 files or 8 MB. Files outside this preview will stay unchanged.</p>}
      {!!changed.length && <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-md border md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="max-h-40 overflow-auto border-b md:max-h-[48dvh] md:border-r md:border-b-0"><div className="flex items-center gap-2 border-b px-3 py-2 text-xs"><Checkbox id="select-format-all" checked={selected.length === changed.length ? true : selected.length ? 'indeterminate' : false} disabled={busy || !!applied} onCheckedChange={(value) => setSelected(value ? changed.map((row) => row.rel) : [])} /><label htmlFor="select-format-all">Select all changes</label></div><ul aria-label="Formatting changes">{changed.map((row) => <li key={row.rel} className={`flex min-h-9 items-center gap-2 px-3 ${active === row.rel ? 'bg-accent' : ''}`}><Checkbox aria-label={`Format ${row.rel}`} checked={selected.includes(row.rel)} disabled={busy || !!applied} onCheckedChange={(value) => setSelected((all) => value ? [...all, row.rel] : all.filter((rel) => rel !== row.rel))} /><button className="min-w-0 flex-1 truncate py-2 text-left font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring" title={row.rel} onClick={() => setActive(row.rel)}>{row.rel}</button></li>)}</ul></div>
        <div aria-label="Formatting diff" className="min-h-0 max-h-[48dvh] overflow-auto">{diff === null ? <p role="status" className="p-4 text-xs text-muted-foreground">Loading diff…</p> : <FileDiff diff={diff} />}</div>
      </div>}
      {!changed.length && <p className="py-6 text-center text-sm">{unchanged ? 'Files already match their formatting rules.' : 'No formatting changes available.'}</p>}
      {!!skipped.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Skipped files and unavailable formatters ({skipped.length})</summary><ul className="mt-2 max-h-32 space-y-1 overflow-auto">{skipped.map((row) => <li key={row.rel}><span className="font-mono">{row.rel}</span> · {row.message || row.status}</li>)}</ul></details>}
    </>}
    {applied && <div role="status" className="text-[13px]"><p>{applied.rows.filter((row) => row.status === 'formatted').length} formatted · {applied.rows.filter((row) => row.status === 'restored').length} restored · {applied.rows.filter((row) => ['error', 'conflict'].includes(row.status)).length} kept or unavailable</p>{applied.rows.filter((row) => row.message).map((row) => <p key={row.rel} className="mt-1 text-xs text-muted-foreground">{row.rel}: {row.message}</p>)}</div>}
    <DialogFooter className="flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => void scan()}><RefreshCw />Rescan</Button>{!!applied?.undoable.length && <Button variant="outline" disabled={busy} onClick={() => void apply(true)}><Undo2 />Undo formatting</Button>}<Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button disabled={busy || !selected.length || !!applied} onClick={() => void apply()}><WandSparkles />{busy && preview ? 'Applying…' : `Apply to ${selected.length} files`}</Button></DialogFooter>
  </>;
}
