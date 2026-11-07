import * as React from 'react';
import { Image as ImageIcon, ImageOff, Maximize2 } from 'lucide-react';
import { ImageDialog } from '@/components/image-preview';
import { Spinner } from '@/components/ui/spinner';
import { projectImagePath } from '@/lib/image-preview.mjs';
import { createImageVisibility, imagePlaceholder } from '@/lib/image-visibility.mjs';
import { useImageResource } from '@/hooks/use-image-resource';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import type { HubBridge } from '@/types';

const documents = new WeakMap<Document, ReturnType<typeof createImageVisibility>>();
let attemptSequence = 0;
function observe(element: Element, listener: (near: boolean) => void) {
  const document = element.ownerDocument;
  let visibility = documents.get(document);
  if (!visibility) { visibility = createImageVisibility(); documents.set(document, visibility); }
  return visibility.observe(element, listener);
}

export function MarkdownImage({ source, alt, baseFile, project: previewProject }: { source: string; alt?: string; baseFile?: string; project?: string }) {
  const s = useStore(); const project = previewProject ?? s.workdir;
  if (/^https?:\/\//i.test(source)) return <span className="my-2 inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-1 text-xs"><ImageIcon className="size-4 shrink-0 text-muted-foreground" /><button type="button" className="min-h-8 truncate text-left underline underline-offset-4 max-sm:min-h-11" onClick={() => s.hub.call('openExternal', source)}>{alt || 'Open image'}</button></span>;
  return <LocalImage source={source} alt={alt} project={project} rel={projectImagePath(source, project, baseFile)} hub={s.hub} />;
}

/** Each visible canvas owns its backing store; the shared lease owns bitmap. */
function GalleryPixels({ bitmap, alt, style, className, onReady, onError }: { bitmap: ImageBitmap; alt: string; style?: React.CSSProperties; className: string; onReady(): void; onError(): void }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const callbacks = React.useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  React.useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    try {
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); if (!context) throw Error('Image surface unavailable');
      context.drawImage(bitmap, 0, 0); callbacks.current.onReady();
    } catch { callbacks.current.onError(); }
    return () => { canvas.width = 0; canvas.height = 0; };
  }, [bitmap]);
  return <canvas ref={ref} role="img" aria-label={alt} style={style} className={className} />;
}

function LocalImage({ source, alt, project, rel, hub }: { source: string; alt?: string; project: string | null; rel: string | null; hub: HubBridge }) {
  const host = React.useRef<HTMLSpanElement>(null), returnFocus = React.useRef<HTMLElement | null>(null);
  // Object identity avoids duplicating a possibly huge URI in a React key.
  const scope = React.useMemo(() => ({}), [source, project, rel, hub]);
  const [nearby, setNearby] = React.useState<{ scope: object; value: boolean } | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [dialog, setDialog] = React.useState<{ scope: object; value: boolean } | null>(null);
  const [retry, setRetry] = React.useState<{ scope: object; value: number } | null>(null);
  const [decoded, setDecoded] = React.useState<{ scope: object; resource: string | ImageBitmap; width: number; height: number } | null>(null);
  const [failure, setFailure] = React.useState<{ scope: object; attempt: number; resource: string | ImageBitmap | null; error: string } | null>(null);
  const near = nearby?.scope === scope && nearby.value, open = dialog?.scope === scope && dialog.value;
  const attempt = retry?.scope === scope ? retry.value : 0, enabled = !!rel && (near || focused || open);
  // A retry must not reuse another reference's earlier failed attempt.
  const retryImage = () => setRetry({ scope, value: ++attemptSequence });
  const image = useImageResource(hub, project, rel, `markdown:${attempt}`, enabled, 'gallery');
  const original = useImageResource(hub, project, rel, `markdown:${attempt}`, !!rel && open);
  const resource = image.bitmap || image.src;
  const current = React.useRef({ scope, resource }); current.current = { scope, resource };
  React.useEffect(() => {
    const element = host.current; if (!element) return;
    let active = true;
    const off = observe(element, value => { if (active) setNearby({ scope, value }); });
    return () => { active = false; off(); };
  }, [scope]);
  React.useEffect(() => { if (image.error) setFailure({ scope, attempt, resource, error: image.error }); }, [scope, attempt, image.error, resource]);
  const error = !rel ? 'Image unavailable' : image.error || (failure?.scope === scope && failure.attempt === attempt && (!resource || failure.resource === resource) ? failure.error : '');
  const loaded = !!resource && decoded?.scope === scope && decoded.resource === resource && !error;
  const dimensions = decoded?.scope === scope ? imagePlaceholder(decoded.width, decoded.height) : null;
  const rendition = image.width && image.height ? imagePlaceholder(image.width, image.height) : null;
  const name = alt || rel?.split('/').pop() || 'Image';
  return <span ref={host} className="my-2 inline-flex max-w-full flex-col align-top" onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    {error ? <span role="status" className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><ImageOff className="size-4 shrink-0" /><span className="min-w-0 truncate">{error.includes('limit') ? 'Image exceeds preview limit.' : error.includes('Too many') ? error : 'Image unavailable'}</span><button type="button" className="min-h-8 shrink-0 rounded px-1 underline underline-offset-4 max-sm:min-h-11" onClick={retryImage}>Retry</button></span>
      : <button type="button" className="group/image relative inline-flex min-h-24 min-w-24 max-w-full items-center justify-center overflow-hidden rounded-lg bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-busy={enabled && !loaded} aria-label={`Expand image: ${name}`} onClick={event => { returnFocus.current = event.currentTarget; setDialog({ scope, value: true }); }}>
        {!loaded && dimensions && <svg {...dimensions} aria-hidden="true" focusable="false" className="m-0 max-h-64 max-w-full" style={{ height: 'auto' }} />}
        {enabled && image.bitmap && <GalleryPixels bitmap={image.bitmap} alt={alt || rel || 'Image'} style={rendition ? { width: rendition.width, height: 'auto', aspectRatio: `${image.width} / ${image.height}` } : undefined} className={cn('m-0 max-h-64 max-w-full rounded-none object-contain', !loaded && !!dimensions && 'absolute opacity-0')} onReady={() => { if (current.current.scope === scope && current.current.resource === resource) setDecoded({ scope, resource: image.bitmap!, width: image.width!, height: image.height! }); }} onError={() => { if (current.current.scope === scope && current.current.resource === resource) setFailure({ scope, attempt, resource, error: 'Image unavailable' }); }} />}
        {image.src && enabled && <img key={image.src} src={image.src} alt={alt || rel || 'Image'} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={cn('m-0 max-h-64 max-w-full rounded-none object-contain', !loaded && !!dimensions && 'absolute opacity-0')} onLoad={event => { if (current.current.scope === scope && current.current.resource === resource) setDecoded({ scope, resource: image.src!, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }} onError={() => { if (current.current.scope === scope && current.current.resource === resource) setFailure({ scope, attempt, resource, error: 'Image unavailable' }); }} />}
        {enabled && !loaded && <Spinner className="absolute size-4" aria-label="Loading image" />}
        {loaded && <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/90 p-1.5 text-foreground opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100 max-sm:opacity-100"><Maximize2 className="size-4" /></span>}
      </button>}
    <ImageDialog src={original.src} name={rel || name} size={original.size} revision={`markdown:${attempt}`} loading={original.loading} unavailable={original.error ? original.error.includes('limit') ? 'Image exceeds preview limit.' : 'Image unavailable' : undefined} onRetry={retryImage} open={open} onOpenChange={value => setDialog({ scope, value })} returnFocus={returnFocus} />
  </span>;
}
