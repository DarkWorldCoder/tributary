import * as React from 'react';
import { toast } from 'sonner';
import { useStore } from '@/store';

/** Native full screen is separate from pane zoom and window maximization. */
export function useFullscreen() {
  const { hub } = useStore();
  const desktop = hub.platform === 'desktop';
  const supported = desktop || !!document.fullscreenEnabled;
  const [active, setActive] = React.useState(!!document.fullscreenElement);
  React.useEffect(() => {
    let alive = true;
    const update = (value: { fullscreen?: boolean }) => { if (alive) setActive(!!value.fullscreen); };
    if (desktop) {
      void hub.call<{ fullscreen: boolean }>('windowState').then(update).catch(() => {});
      const off = hub.on('window-state', update);
      return () => { alive = false; if (typeof off === 'function') off(); };
    }
    const change = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [desktop, hub]);
  const toggle = React.useCallback(async () => {
    try {
      if (desktop) {
        const state = await hub.call<{ fullscreen: boolean }>('windowAction', 'fullscreen');
        setActive(!!state.fullscreen);
      } else if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await document.documentElement.requestFullscreen();
      else toast.error('Full screen is controlled by your host app.');
    } catch { toast.error('Could not change full screen. Try the window controls.'); }
  }, [desktop, hub]);
  return { active, supported, toggle };
}
