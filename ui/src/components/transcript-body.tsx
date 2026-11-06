import * as React from 'react';
import { flushSync } from 'react-dom';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { codeHasInteraction } from '@/lib/code-viewport.mjs';

type Entry = { root: HTMLElement; near: boolean; resume: (selected?: boolean) => void; park: () => void };
function createBodyWindow() {
  const entries = new Map<HTMLElement, Entry>();
  let observer: IntersectionObserver | null = null, viewport: HTMLElement | null = null, document: Document | null = null;
  let frame = 0, printing = false;
  const anchor = () => {
    if (!viewport) return null;
    const top = viewport.getBoundingClientRect().top;
    const node = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > top);
    return node ? { node, top: node.getBoundingClientRect().top } : null;
  };
  const commit = (work: () => void) => {
    const before = anchor(); flushSync(work);
    if (before?.node.isConnected && viewport) viewport.scrollTop += before.node.getBoundingClientRect().top - before.top;
  };
  const synchronize = () => {
    cancelAnimationFrame(frame); frame = 0;
    const selection = document?.getSelection();
    commit(() => {
      for (const entry of entries.values()) {
        // This includes a range spanning several parked replies, as in Select All.
        let selected = false;
        if (selection && !selection.isCollapsed) for (let n = 0; n < selection.rangeCount; n++) {
          try { if (selection.getRangeAt(n).intersectsNode(entry.root)) selected = true; } catch { /* detached range */ }
        }
        if (printing || entry.near || selected) entry.resume(selected || printing); else entry.park();
      }
    });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(synchronize); };
  const beforePrint = () => { printing = true; synchronize(); };
  const afterPrint = () => { printing = false; schedule(); };
  return {
    register(root: HTMLElement, resume: (selected?: boolean) => void, park: () => void) {
      if (!observer) {
        viewport = root.closest<HTMLElement>('[data-slot="message-scroller-viewport"]'); document = root.ownerDocument;
        observer = new IntersectionObserver(changes => {
          for (const change of changes) { const entry = entries.get(change.target as HTMLElement); if (entry) entry.near = change.isIntersecting; }
          schedule();
        }, { root: viewport, rootMargin: '800px 0px' });
        document.addEventListener('selectionchange', schedule);
        document.defaultView?.addEventListener('beforeprint', beforePrint); document.defaultView?.addEventListener('afterprint', afterPrint);
      }
      entries.set(root, { root, near: false, resume, park }); observer.observe(root);
      return () => { observer?.unobserve(root); entries.delete(root); };
    },
    refresh: schedule,
    dispose() {
      observer?.disconnect(); observer = null;
      document?.removeEventListener('selectionchange', schedule);
      document?.defaultView?.removeEventListener('beforeprint', beforePrint); document?.defaultView?.removeEventListener('afterprint', afterPrint); document = null; viewport = null;
      cancelAnimationFrame(frame); frame = 0; entries.clear();
    },
  };
}
const BodyWindow = React.createContext<ReturnType<typeof createBodyWindow> | null>(null);
export function TranscriptBodies({ children }: { children: React.ReactNode }) {
  const [owner] = React.useState(createBodyWindow);
  React.useEffect(() => () => owner.dispose(), [owner]);
  return <BodyWindow.Provider value={owner}>{children}</BodyWindow.Provider>;
}

/** Only derived rich rendering is released. Source remains owned by the thread.
 * Native Find can reveal the stable hidden-until-found source node as plain text.
 * Explicitly used code viewers keep their state until this conversation closes. */
export function TranscriptBody({ text, eager, windowed = true }: { text: string; eager: boolean; windowed?: boolean }) {
  const owner = React.useContext(BodyWindow), root = React.useRef<HTMLDivElement>(null), source = React.useRef<HTMLDivElement>(null), rich = React.useRef<HTMLDivElement>(null);
  const supported = typeof IntersectionObserver !== 'undefined' && typeof ResizeObserver !== 'undefined' && typeof HTMLElement !== 'undefined' && 'onbeforematch' in HTMLElement.prototype;
  const [mode, setMode] = React.useState<'rich' | 'parked' | 'plain'>(() => eager || !supported ? 'rich' : 'parked');
  const current = React.useRef({ mode, eager }); current.current = { mode, eager };
  const height = React.useRef(Math.max(80, Math.ceil(text.length / 72) * 24));
  const usedCode = React.useRef(false), restoreFocus = React.useRef(false);
  React.useLayoutEffect(() => {
    const target = source.current; if (!target) return;
    if (mode === 'plain') target.removeAttribute('hidden');
    else target.setAttribute('hidden', mode === 'parked' ? 'until-found' : '');
  }, [mode]);
  React.useLayoutEffect(() => {
    const target = rich.current; if (!target || !windowed) return;
    const measure = () => { const next = target.getBoundingClientRect().height; if (next > 0) height.current = next; };
    measure();
    if (restoreFocus.current) { restoreFocus.current = false; (target.querySelector<HTMLElement>('a, button, [tabindex="0"]') || target).focus({ preventScroll: true }); }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(target); return () => observer.disconnect();
  }, [mode, windowed]);
  React.useEffect(() => {
    const target = root.current; if (!target || !owner || !supported || !windowed) return;
    const resume = (selected = false) => { if (current.current.mode === 'parked' && (selected || !target.contains(target.ownerDocument.activeElement))) setMode('rich'); };
    const park = () => {
      if (current.current.eager || current.current.mode !== 'rich' || usedCode.current || codeHasInteraction(target) || target.querySelector('[aria-pressed="true"], .cm-search') || target.ownerDocument.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const next = rich.current?.getBoundingClientRect().height; if (next) height.current = next;
      setMode('parked');
    };
    const found = () => { flushSync(() => setMode('plain')); };
    const blur = () => queueMicrotask(owner.refresh);
    const unregister = owner.register(target, resume, park);
    target.addEventListener('beforematch', found); target.addEventListener('focusout', blur);
    return () => { unregister(); target.removeEventListener('beforematch', found); target.removeEventListener('focusout', blur); };
  }, [owner, supported, windowed]);
  React.useLayoutEffect(() => { if (eager && mode !== 'rich') setMode('rich'); if (windowed) owner?.refresh(); }, [eager, mode, owner, windowed]);
  const pinCode = (event: React.SyntheticEvent) => { if ((event.target as Element)?.closest?.('.code-viewport')) usedCode.current = true; };
  return <div ref={root} onFocusCapture={pinCode} onWheelCapture={pinCode} data-transcript-body={mode} style={mode === 'parked' ? { height: height.current } : undefined} className="relative min-w-0">
    <div ref={source} data-transcript-source className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed">{mode === 'rich' ? null : text}</div>
    {mode === 'rich' ? <div ref={rich} tabIndex={-1} className="flow-root outline-none"><Markdown text={text} /></div> : <Button size="xs" variant="ghost" className={mode === 'parked' ? 'absolute top-0 left-0' : 'mt-2'} onClick={() => { usedCode.current = true; restoreFocus.current = true; setMode('rich'); }}>{mode === 'plain' ? 'Show formatted reply' : 'Show reply'}</Button>}
  </div>;
}
