import * as React from 'react';
import { captureTreeViewport, restoreTreeViewport, type TreeViewport } from '@/lib/tree-viewport.mjs';

export function useTreeViewport(shown: boolean, navigationKey: string) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const saved = React.useRef<TreeViewport | null>(null);
  const visible = React.useRef(shown); visible.current = shown;
  const previousNavigation = React.useRef(navigationKey);
  React.useEffect(() => {
    const element = viewport.current; if (!element || !shown) return;
    if (previousNavigation.current !== navigationKey) saved.current = null;
    previousNavigation.current = navigationKey;
    const target = saved.current; let restoring = !!target;
    const observer = target ? new MutationObserver(() => { if (restoring && visible.current) restoreTreeViewport(element, target); }) : null;
    const remember = () => { if (visible.current && !restoring && element.getBoundingClientRect().width) saved.current = captureTreeViewport(element); };
    // Restoration follows async page/child insertion, until real navigation or
    // user interaction takes ownership. No row node is retained in the memento.
    const takeControl = () => { restoring = false; observer?.disconnect(); remember(); };
    if (observer) observer.observe(element, { childList: true, subtree: true });
    const frame = requestAnimationFrame(() => { if (target && restoring && visible.current) restoreTreeViewport(element, target); });
    element.addEventListener('scroll', remember, { passive: true });
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'focusin']) element.addEventListener(event, takeControl, { capture: true, passive: true });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); element.removeEventListener('scroll', remember); for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'focusin']) element.removeEventListener(event, takeControl, true); };
  }, [shown, navigationKey]);
  return viewport;
}
