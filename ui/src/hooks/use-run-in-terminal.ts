import * as React from 'react';
import { useStore } from '@/store';

export type TerminalRequest = { command: string; cwd: string | null };
let pendingCommand: TerminalRequest | null = null;
export function takePendingTerminalCommand() { const command = pendingCommand; pendingCommand = null; return command; }
/** Keep the launcher lightweight so the terminal emulator loads only when opened. */
export function useRunInTerminal() {
  const s = useStore();
  return React.useCallback((command: string, cwd = s.workdir) => {
    if (s.hub.platform === 'vscode') { s.hub.call('createTerminal', { cwd, command }); return; }
    pendingCommand = { command, cwd };
    s.setTerminalOpen(true);
    // A kept-mounted panel consumes immediately; a lazy panel takes it on mount.
    window.dispatchEvent(new Event('tributary:run-in-terminal'));
  }, [s]);
}
