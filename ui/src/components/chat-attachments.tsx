import * as React from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { FileTypeIcon } from '@/components/file-type-icon';
import { useStore } from '@/store';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ImagePreview } from '@/components/image-preview';
import { ImagePixels } from '@/components/image-pixels';
import { useAttachmentImage } from '@/hooks/use-image-resource';
import { observeImage } from '@/lib/image-visibility.mjs';
import type { Attachment } from '@/types';

let attemptSequence = 0;
type TextBody = { content: string | null; element: HTMLPreElement | null };
function AttachmentText({ body, name }: { body: TextBody; name: string }) {
  const ref = React.useRef<HTMLPreElement>(null);
  React.useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    body.element = element; element.textContent = body.content || '';
    return () => { element.replaceChildren(); if (body.element === element) body.element = null; };
  }, [body]);
  return <pre ref={ref} tabIndex={0} aria-label={`Contents of ${name}`} className="h-full overflow-auto p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words" />;
}
function AttachmentCard({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  const s = useStore(), card = React.useRef<HTMLDivElement>(null), returnFocus = React.useRef<HTMLButtonElement | null>(null);
  const scope = React.useMemo(() => ({}), [file.id, file.mime, file.size, s.hub]);
  const [nearby, setNearby] = React.useState<{ scope: object; value: boolean } | null>(null), [focused, setFocused] = React.useState(false);
  const [dialog, setDialog] = React.useState<{ scope: object; value: boolean } | null>(null), [retry, setRetry] = React.useState<{ scope: object; value: number } | null>(null);
  const [failure, setFailure] = React.useState<{ scope: object; attempt: number; resource: string | ImageBitmap | null } | null>(null);
  const [textPreview, setTextPreview] = React.useState<{ scope: object; body?: TextBody; error?: boolean } | null>(null);
  const near = nearby?.scope === scope && nearby.value, open = dialog?.scope === scope && dialog.value, attempt = retry?.scope === scope ? retry.value : 0, isImage = file.mime.startsWith('image/');
  const image = useAttachmentImage(s.hub, file, isImage && (near || focused || open), 'thumbnail', attempt);
  const original = useAttachmentImage(s.hub, file, isImage && open, 'original', attempt);
  const resource = image.bitmap || image.src, current = React.useRef({ scope, resource }); current.current = { scope, resource };
  const imageError = !!image.error || (failure?.scope === scope && failure.attempt === attempt && failure.resource === resource);
  const failImage = () => { if (current.current.scope === scope && current.current.resource === resource) setFailure({ scope, attempt, resource }); };
  const retryPreview = () => { setRetry({ scope, value: ++attemptSequence }); setFailure(null); };
  React.useEffect(() => {
    const target = card.current; if (!target) return;
    let active = true; const off = observeImage(target, value => { if (active) setNearby({ scope, value }); });
    return () => { active = false; off(); };
  }, [scope]);
  React.useEffect(() => {
    setTextPreview(null);
    if (!open || file.mime !== 'text/plain') return;
    let alive = true, body: TextBody | undefined;
    s.hub.call<{ content: string; truncated: boolean }>('readAttachment', file.id, { preview: 'text' }).then(value => {
      if (alive) { body = { content: value.content + (value.truncated ? '\n\n… Preview limited to 256 KB.' : ''), element: null }; setTextPreview({ scope, body }); }
    }).catch(() => { if (alive) setTextPreview({ scope, error: true }); });
    return () => { alive = false; if (body) { body.content = null; body.element?.replaceChildren(); body.element = null; } };
  }, [scope, open, attempt, file.id, file.mime, s.hub]);
  const text = textPreview?.scope === scope ? textPreview : null;
  return <div ref={card} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }} className="relative flex max-w-48 items-center gap-2 rounded-lg border bg-muted/40 p-2">
    <button type="button" disabled={!isImage && file.mime !== 'text/plain'} aria-label={`Preview ${file.name}`} aria-busy={isImage && image.loading} onClick={event => { returnFocus.current = event.currentTarget; setDialog({ scope, value: true }); }} className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
      {isImage ? !imageError && image.bitmap ? <ImagePixels bitmap={image.bitmap} alt={file.name} className="size-12 shrink-0 rounded object-cover" onError={failImage} /> : !imageError && image.src ? <img key={image.src} src={image.src} alt="" decoding="async" onError={failImage} className="size-12 shrink-0 rounded object-cover" /> : <span className="grid size-12 shrink-0 place-items-center"><ImageIcon className="size-5" /></span> : <FileTypeIcon path={file.name} className="size-5 shrink-0" />}<span className="min-w-0"><span className="block truncate text-xs" title={file.name}>{file.name}</span><span className="block text-[11px] text-muted-foreground">{imageError || text?.error ? 'Preview unavailable' : `${Math.ceil(file.size / 1024)} KB`}</span></span>
    </button>
    {onRemove && <button type="button" className="grid size-7 shrink-0 place-items-center rounded hover:bg-muted max-sm:size-11" aria-label={`Remove ${file.name}`} onClick={onRemove}><X className="size-3.5" /></button>}
    <Dialog open={open} onOpenChange={value => setDialog({ scope, value })}><DialogContent showCloseButton={false} onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }); } }} className="flex h-[80dvh] max-w-[90vw] flex-col gap-0 p-0 sm:max-w-[90vw]"><header className="workbench-toolbar gap-2 border-b px-3"><DialogTitle className="min-w-0 flex-1 truncate text-[13px] font-medium">{file.name}</DialogTitle><DialogClose asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Close attachment preview"><X /></Button></DialogClose></header><DialogDescription className="sr-only">{file.name}</DialogDescription><div className="min-h-0 flex-1">{file.mime === 'text/plain' ? text?.error ? <div role="alert" className="space-y-3 p-4 text-sm"><p>Could not load this file.</p><Button variant="outline" size="sm" onClick={retryPreview}>Retry</Button></div> : !text?.body ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading file…</p> : <AttachmentText body={text.body} name={file.name} /> : <ImagePreview src={original.src} name={file.name} size={original.size ?? file.size} revision={attempt} loading={original.loading} unavailable={original.error ? 'Could not load this image.' : undefined} onRetry={retryPreview} />}</div></DialogContent></Dialog>
  </div>;
}
export function ChatAttachments({ files, onRemove }: { files: Attachment[]; onRemove?: (id: string) => void }) {
  return <div role="group" aria-label="Attachments" className="flex max-w-full flex-wrap gap-2 py-2">{files.map((file) => <AttachmentCard key={file.id} file={file} onRemove={onRemove ? () => onRemove(file.id) : undefined} />)}</div>;
}
