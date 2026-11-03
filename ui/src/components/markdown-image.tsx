import * as React from 'react';
import { Image as ImageIcon, ImageOff, Maximize2 } from 'lucide-react';
import { ImageDialog } from '@/components/image-preview';
import { Spinner } from '@/components/ui/spinner';
import { imageSource, projectImagePath } from '@/lib/image-preview.mjs';
import { useStore } from '@/store';
import type { FileContent } from '@/types';

export function MarkdownImage({ source, alt, baseFile }: { source: string; alt?: string; baseFile?: string }) {
  const s = useStore(); const host = React.useRef<HTMLSpanElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const [visible, setVisible] = React.useState(false); const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<FileContent | null>(null); const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false); const [attempt, setAttempt] = React.useState(0);
  const remote = /^https?:\/\//i.test(source);
  const rel = remote ? null : projectImagePath(source, s.project, baseFile);
  React.useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [source]);
  React.useEffect(() => {
    setFailed(false); setLoaded(false); setFile(null); setOpen(false);
    if (!visible || remote) return;
    if (!rel) { setFailed(true); return; }
    let current = true;
    s.hub.call<FileContent>('readFile', s.project, rel).then((result) => { if (current) { setFile(result); if (!imageSource(result)) setFailed(true); } }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [source, rel, s.project, s.hub, visible, remote, attempt]);
  const src = React.useMemo(() => file ? imageSource(file) : null, [file]);
  const name = alt || rel?.split('/').pop() || 'Image';
  if (remote) return <span className="my-2 inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-1 text-xs"><ImageIcon className="size-4 shrink-0 text-muted-foreground" /><button type="button" className="min-h-8 truncate text-left underline underline-offset-4 max-sm:min-h-11" onClick={() => s.hub.call('openExternal', source)}>{alt || 'Open image'}</button></span>;
  return <span ref={host} className="my-2 inline-flex max-w-full flex-col align-top">
    {failed ? <span role="status" className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><ImageOff className="size-4 shrink-0" /><span className="min-w-0 truncate">{file?.truncated ? 'Image exceeds preview limit.' : 'Image unavailable'}</span><button type="button" className="min-h-8 shrink-0 rounded px-1 underline underline-offset-4 max-sm:min-h-11" onClick={() => setAttempt((value) => value + 1)}>Retry</button></span>
      : <button type="button" className="group/image relative inline-flex min-h-24 min-w-24 max-w-full items-center justify-center overflow-hidden rounded-lg bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!loaded} aria-label={`Expand image: ${name}`} onClick={(event) => { returnFocus.current = event.currentTarget; setOpen(true); }}>
        {src && visible && <img key={attempt} src={src} alt={alt || rel || 'Image'} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="m-0 max-h-64 max-w-full rounded-none object-contain" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
        {!loaded && <Spinner className="absolute size-4" aria-label="Loading image" />}
        {loaded && <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/90 p-1.5 text-foreground opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100 max-sm:opacity-100"><Maximize2 className="size-4" /></span>}
      </button>}
    <ImageDialog src={src} name={rel || name} size={file?.size} open={open} onOpenChange={setOpen} returnFocus={returnFocus} />
  </span>;
}
