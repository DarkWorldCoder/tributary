import * as React from 'react';
import { Ellipsis, ImageOff, Maximize2, Minus, Plus, RectangleHorizontal, Scan, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fitImageScale, imageBytes } from '@/lib/image-preview.mjs';

type Props = { src: string | null; name: string; size?: number; unavailable?: string; revision?: number | string; loading?: boolean; onRetry?: () => void };
function ImageCanvas({ src, name, size, unavailable, loading = false, onRetry, expand }: Props & { expand?: () => void }) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = React.useState({ width: 0, height: 0 });
  const [natural, setNatural] = React.useState({ width: 0, height: 0 });
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [zoom, setZoom] = React.useState<number | null>(null);
  React.useEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(() => setBounds({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const scale = zoom ?? fitImageScale(natural.width, natural.height, bounds.width, bounds.height);
  const ready = !!natural.width && !failed;
  const changeZoom = (direction: number) => setZoom(Math.min(8, Math.max(0.05, scale * (direction > 0 ? 1.25 : 0.8))));
  const reset = (value: number | null) => { setZoom(value); viewport.current?.scrollTo(0, 0); };
  const control = (label: string, icon: React.ReactNode, action: () => void, pressed?: boolean, disabled = !ready) => <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={action}>{icon}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
  return <div className="image-preview flex h-full min-h-0 flex-col">
    <div ref={viewport} role="region" aria-label={`Image preview: ${name}`} tabIndex={0} className="image-canvas relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onKeyDown={(event) => {
      if (!ready || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['+', '=', '-', '0', '1'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === '0') reset(null); else if (event.key === '1') reset(1); else changeZoom(event.key === '-' ? -1 : 1); }
    }}>
      {src && !failed && <div className="grid place-items-center" style={{ width: Math.max(bounds.width, natural.width * scale + 32), height: Math.max(bounds.height, natural.height * scale + 32) }}>
        <img key={attempt} src={src} alt={name} draggable={false} decoding="async" referrerPolicy="no-referrer" className="image-preview-content" style={{ width: natural.width * scale, height: natural.height * scale, maxWidth: 'none', maxHeight: 'none' }} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
      </div>}
      {loading ? <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner />Loading image…</div> : (!src || failed) ? <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-xs text-muted-foreground"><ImageOff className="size-6" /><span>{unavailable || 'This image could not be displayed.'}</span>{(src || onRetry) && <Button variant="outline" size="sm" className="max-sm:min-h-11" onClick={() => { if (onRetry) onRetry(); else { setFailed(false); setNatural({ width: 0, height: 0 }); setAttempt((value) => value + 1); } }}>Retry</Button>}</div>
        : !ready && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner />Loading image…</div>}
    </div>
    <footer className="image-footer flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-t bg-card px-2 py-0.5 max-sm:justify-center">
      <span className="min-w-0 truncate px-1 py-1 text-xs tabular-nums text-muted-foreground" title={name}>{ready ? `${natural.width.toLocaleString()} × ${natural.height.toLocaleString()}` : name.split('/').pop()}{size != null && ` · ${imageBytes(size)}`}</span>
      <div role="group" aria-label="Image controls" className="flex shrink-0 items-center">
        <span className="image-size-controls flex">{control('Fit image (0)', <Scan />, () => reset(null), zoom == null)}
        {control('Actual size (1)', <RectangleHorizontal />, () => reset(1), zoom === 1)}</span>
        <span className="image-zoom-controls inline-flex items-center rounded-full bg-muted/50 p-0.5">
          {control('Zoom out', <Minus />, () => changeZoom(-1), undefined, !ready || scale <= 0.05)}
          <span role="status" aria-label="Image zoom" className="image-zoom-label inline-flex w-11 items-center justify-center text-xs tabular-nums text-muted-foreground">{ready ? `${Math.round(scale * 100)}%` : '—'}</span>
          {control('Zoom in', <Plus />, () => changeZoom(1), undefined, !ready || scale >= 8)}
        </span>
        {expand && <span className="image-expand-control">{control('Expand image', <Maximize2 />, expand)}</span>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="workbench-action image-options" aria-label="Image options" disabled={!ready}><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-sm:[&_[role=menuitem]]:min-h-11"><DropdownMenuItem onSelect={() => reset(null)}><Scan />Fit image</DropdownMenuItem><DropdownMenuItem onSelect={() => reset(1)}><RectangleHorizontal />Actual size</DropdownMenuItem>{expand && <DropdownMenuItem onSelect={expand}><Maximize2 />Expand image</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
      </div>
    </footer>
  </div>;
}

export function ImageDialog({ open, onOpenChange, returnFocus, ...props }: Props & { open: boolean; onOpenChange: (value: boolean) => void; returnFocus?: React.RefObject<HTMLElement | null> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { if (returnFocus?.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }); } }} className="image-dialog flex h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
      <header className="workbench-toolbar gap-2 border-b px-2"><DialogTitle className="min-w-0 flex-1 truncate pl-1 text-[13px]" title={props.name}>{props.name.split('/').pop()}</DialogTitle><DialogClose asChild><Button variant="ghost" size="icon-sm" className="workbench-action" aria-label="Close image viewer"><X /></Button></DialogClose></header>
      <DialogDescription className="sr-only">{props.name}</DialogDescription>
      <div className="min-h-0 flex-1"><ImageCanvas key={`${props.name}:${props.revision ?? ''}:${props.src?.startsWith('blob:') ? props.src : ''}`} {...props} /></div>
    </DialogContent>
  </Dialog>;
}

export function ImagePreview(props: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  return <><ImageCanvas key={`${props.name}:${props.revision ?? ''}:${props.src?.startsWith('blob:') ? props.src : ''}`} {...props} expand={() => { returnFocus.current = document.activeElement as HTMLElement; setExpanded(true); }} /><ImageDialog {...props} open={expanded} onOpenChange={setExpanded} returnFocus={returnFocus} /></>;
}
