import * as React from 'react';

/** A visible canvas owns its backing store; the shared resource owns bitmap. */
export function ImagePixels({ bitmap, alt, style, className, onReady, onError }: { bitmap: ImageBitmap; alt: string; style?: React.CSSProperties; className: string; onReady?(): void; onError(): void }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const callbacks = React.useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  React.useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    try {
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); if (!context) throw Error('Image surface unavailable');
      context.drawImage(bitmap, 0, 0); callbacks.current.onReady?.();
    } catch { callbacks.current.onError(); }
    return () => { canvas.width = 0; canvas.height = 0; };
  }, [bitmap]);
  return <canvas ref={ref} role="img" aria-label={alt} style={style} className={className} />;
}
