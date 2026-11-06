import * as React from 'react';
import { useStore } from '@/store';

export type WorkbenchRequest = { id: string; threadId: string; project: string; action: string; input: { path?: string; line?: number; column?: number; start_line?: number; count?: number; group?: number; direction?: string; panel?: string; revision?: string; old_text?: string; new_text?: string } };
export type EditorCommand = WorkbenchRequest & { claimed: boolean; valid: () => boolean; resolve: (result: unknown) => void; reject: (error: Error) => void };

/** Semantic commands only: agents cannot click approvals or execute UI JavaScript. */
export function AgentWorkbench() {
  const s = useStore(); const current = React.useRef(s); current.current = s;
  React.useEffect(() => {
    const pending = new Map<string, () => void>();
    const off = s.hub.on('workbench', (request: WorkbenchRequest) => {
      if (request.action === 'cancel') { pending.get(request.id)?.(); return; }
      const valid = () => { const st = current.current; return st.thread?.id === request.threadId && st.workdir === request.project && !st.document && !st.home; };
      let done = false, frame = 0;
      const finish = (result: unknown, error?: string) => { if (done) return; done = true; cancelAnimationFrame(frame); clearTimeout(timer); pending.delete(request.id); void s.hub.call('workbenchReply', request.id, result, error).catch(() => {}); };
      const cancel = () => finish(null, 'The workspace closed.');
      const timer = setTimeout(() => finish(null, 'Open a code file in this workspace first.'), ['format', 'save_editor'].includes(request.action) ? 60000 : 8000);
      pending.set(request.id, cancel);
      if (!valid()) return finish(null, 'This chat is not the visible workspace. Open it before requesting editor control.');
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return finish(null, 'Close the open dialog before controlling the editor.');
      if (request.action === 'show_panel') {
        const panel = request.input.panel;
        if (panel === 'terminal') { current.current.openPanel('files'); current.current.setTerminalOpen(true); }
        else if (panel === 'debugger') { current.current.openPanel('files'); current.current.setDebugOpen(true); }
        else current.current.openPanel(panel as 'files');
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { if (!valid()) finish(null, 'The visible workspace changed.'); else finish({ shown: panel }); }); });
        return;
      }
      current.current.openPanel('files');
      const command: EditorCommand = { ...request, claimed: false, valid: () => !done && valid(), resolve: result => finish(result), reject: error => finish(null, error.message) };
      // Lazy workspace loading may take several frames; dispatch only until one
      // matching folder claims the request, never repeat an admitted operation.
      const dispatch = () => { if (!command.valid()) return finish(null, 'The visible workspace changed.'); window.dispatchEvent(new CustomEvent('tributary:agent-editor', { detail: command })); if (!command.claimed) frame = requestAnimationFrame(dispatch); };
      frame = requestAnimationFrame(dispatch);
    });
    return () => { if (typeof off === 'function') off(); for (const cancel of [...pending.values()]) cancel(); };
  }, [s.hub]);
  return null;
}
