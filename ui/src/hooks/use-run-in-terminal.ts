import * as React from 'react';
import { useStore } from '@/store';

let pendingCommand: string | null = null;
export function takePendingTerminalCommand() { const command = pendingCommand; pendingCommand = null; return command; }
/** Keep the launcher lightweight so the terminal emulator loads only when opened. */
export function useRunInTerminal() {
  const s = useStore();
  return React.useCallback((command: string) => {
    if (s.hub.platform === 'vscode') { s.hub.call('createTerminal', { cwd: s.project, command }); return; }
    if (!s.terminalOpen) { pendingCommand = command; s.setTerminalOpen(true); return; }
    window.dispatchEvent(new CustomEvent('tributary:run-in-terminal', { detail: command }));
  }, [s]);
}
