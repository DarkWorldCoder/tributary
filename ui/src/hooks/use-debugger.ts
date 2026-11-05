import * as React from 'react';
import { useStore } from '@/store';
import { emptyDebugState, type DebugState } from '@/lib/debug-types';
export function useDebugger(project: string | null, active = true) {
  const { hub } = useStore(); const [state, setState] = React.useState<DebugState>(() => emptyDebugState(project || ''));
  React.useEffect(() => {
    if (!active || !project || hub.platform === 'mock') { setState(emptyDebugState(project || '')); return; }
    let alive = true; let received = false; setState(emptyDebugState(project));
    const off = hub.on('debugger', (next: DebugState) => { if (alive && next.project === project) { received = true; setState(next); } });
    hub.call<DebugState>('debugState', project).then((value) => { if (alive && !received) setState(value); }).catch(() => {});
    return () => { alive = false; if (typeof off === 'function') off(); };
  }, [hub, project, active]);
  return state.project === project ? state : emptyDebugState(project || '');
}
