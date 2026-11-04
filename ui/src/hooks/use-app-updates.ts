import * as React from 'react';
import { useStore } from '@/store';
import type { AppUpdateState } from '@/lib/update-types';

export function useAppUpdates() {
  const { hub } = useStore();
  const [state, setState] = React.useState<AppUpdateState | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (hub.platform !== 'desktop') return;
    let alive = true; let received = false;
    const off = hub.on('app-update', (state) => { received = true; setState(state); });
    void hub.call<AppUpdateState>('updateState').then((state) => { if (alive && !received) setState(state); }).catch(() => { if (alive) setError('Updates are available in the latest desktop build.'); });
    return () => { alive = false; if (typeof off === 'function') off(); };
  }, [hub]);
  const call = async (method: string, ...args: unknown[]) => {
    setError('');
    try { const next = await hub.call<AppUpdateState>(method, ...args); setState(next); return next; }
    catch (error) { setError((error as Error).message); return null; }
  };
  return { state, error, call };
}
