import * as React from 'react';
import { File, Image as ImageIcon, X } from 'lucide-react';
import { useStore } from '@/store';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ImagePreview } from '@/components/image-preview';
import type { Attachment } from '@/types';

function AttachmentCard({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  const s = useStore(); const [src, setSrc] = React.useState<string | null>(null); const [open, setOpen] = React.useState(false); const [error, setError] = React.useState(false);
  const card = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => { const target = card.current; if (!target) return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' }); observer.observe(target); return () => observer.disconnect(); }, []);
  React.useEffect(() => {
    setSrc(null); setError(false);
    if (!visible || !file.mime.startsWith('image/')) return;
    let alive = true; let url = '';
    s.hub.call<Attachment & { base64: string }>('readAttachment', file.id).then((value) => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0)); url = URL.createObjectURL(new Blob([bytes], { type: file.mime })); setSrc(url);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [file.id, file.mime, s.hub, visible]);
  return <div ref={card} className="relative flex max-w-48 items-center gap-2 rounded-lg border bg-muted/40 p-2">
    <button type="button" disabled={!src || error} aria-label={`Preview ${file.name}`} onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
      {src && !error ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setError(true)} className="size-12 shrink-0 rounded object-cover" /> : file.mime.startsWith('image/') ? <ImageIcon className="size-5 shrink-0 text-muted-foreground" /> : <File className="size-5 shrink-0 text-muted-foreground" />}<span className="min-w-0"><span className="block truncate text-xs" title={file.name}>{file.name}</span><span className="block text-[11px] text-muted-foreground">{error ? 'Preview unavailable' : `${Math.ceil(file.size / 1024)} KB`}</span></span>
    </button>
    {onRemove && <button type="button" className="grid size-7 shrink-0 place-items-center rounded hover:bg-muted max-sm:size-11" aria-label={`Remove ${file.name}`} onClick={onRemove}><X className="size-3.5" /></button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent showCloseButton={false} className="flex h-[80dvh] max-w-[90vw] flex-col gap-0 p-0 sm:max-w-[90vw]"><header className="workbench-toolbar gap-2 border-b px-3"><DialogTitle className="min-w-0 flex-1 truncate text-[13px] font-medium">{file.name}</DialogTitle><DialogClose asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Close attachment preview"><X /></Button></DialogClose></header><div className="min-h-0 flex-1"><ImagePreview src={src} name={file.name} size={file.size} /></div></DialogContent></Dialog>
  </div>;
}
export function ChatAttachments({ files, onRemove }: { files: Attachment[]; onRemove?: (id: string) => void }) {
  return <div role="group" aria-label="Attachments" className="flex max-w-full flex-wrap gap-2 py-2">{files.map((file) => <AttachmentCard key={file.id} file={file} onRemove={onRemove ? () => onRemove(file.id) : undefined} />)}</div>;
}
