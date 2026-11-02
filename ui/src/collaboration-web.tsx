import * as React from 'react';
import { CollaborationClient } from '../../core/collaboration/client.mjs';
import type { RoomState } from '../../core/collaboration/client.mjs';
import { ProjectRoom, type RoomBridge } from '@/components/project-room';

export function CollaborationWeb() {
  const bridge = React.useMemo<RoomBridge>(() => {
    const listeners = new Set<(s: RoomState) => void>();
    const client = new CollaborationClient((s) => listeners.forEach((fn) => fn(s)));
    return {
      async call<T>(method: string, ...args: unknown[]): Promise<T> {
        let result: unknown;
        if (method === 'collaborationState') result = client.state();
        else if (method === 'collaborationConnect') { const input = args[0] as { endpoint: string; accessKey: string }; if (new URL(input.endpoint).origin !== location.origin) throw new Error('Use this project service’s own address in the browser.'); result = await client.connect(input); }
        else if (method === 'collaborationDisconnect') result = client.disconnect();
        else if (method === 'collaborationWatch') result = await client.watch(String(args[0]));
        else if (method === 'collaborationCommand') result = await client.command(String(args[0]), args[1] as Record<string, unknown>, args[2] as string);
        else throw new Error('Unsupported project-room operation.');
        return result as T;
      },
      on(_name, fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
  }, []);
  React.useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply(); media.addEventListener('change', apply); document.title = 'Project room · Tributary';
    return () => { media.removeEventListener('change', apply); bridge.call('collaborationDisconnect'); };
  }, [bridge]);
  return <div className="h-svh"><ProjectRoom bridge={bridge} endpoint={location.origin} /></div>;
}
