import * as React from 'react';
import type { HubBridge } from '@/types';

/** Releasing language work must not unmount the editor or its undo history. */
export function useLanguageOwner(hub: HubBridge, project: string | null, path: string, revision: string, enabled: boolean, kind: 'language' | 'eslint' = 'language') {
  const scope = React.useMemo(() => ({}), [hub, project, path, revision, enabled, kind]);
  const [lease, setLease] = React.useState<{ scope: object; owner: string | null; error: string } | null>(null);
  React.useEffect(() => {
    if (!enabled || !project) return;
    let current = true; let owner: string | null = null;
    const close = (token: string) => { void hub.call(kind === 'eslint' ? 'eslintClose' : 'languageClose', project, path, token).catch(() => {}); };
    void hub.call<string>(kind === 'eslint' ? 'eslintAcquire' : 'languageAcquire', project, path).then((token) => {
      owner = token;
      if (!current) close(token); else setLease({ scope, owner: token, error: '' });
    }).catch((error: Error) => { if (current) setLease({ scope, owner: null, error: error.message }); });
    return () => { current = false; if (owner) close(owner); };
  }, [hub, project, path, scope, enabled, kind]);
  return lease?.scope === scope ? lease : { owner: null, error: '' };
}
