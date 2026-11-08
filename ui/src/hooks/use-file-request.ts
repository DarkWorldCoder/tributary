import * as React from 'react';
import type { FileRequests } from '@/lib/file-request.mjs';

export function useFileRequest(requests: FileRequests, projects: string | readonly string[]) {
  const subscribe = React.useCallback((notify: () => void) => requests.subscribe(projects, notify), [requests, projects]);
  const getSnapshot = React.useCallback(() => requests.getSnapshot(projects), [requests, projects]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
