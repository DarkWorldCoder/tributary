import * as React from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useSidebar } from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

function savedWidth(key: string) {
  try { const value = Number(localStorage.getItem(key)); return value > 0 && Number.isFinite(value) ? value : null; } catch { return null; }
}

/** Keyed panes retain documents and terminal sessions when the layout changes. */
export function WorkspaceLayout({ project, visible, expanded, editorFirst = false, chat, workspace }: { project: string | null; visible: boolean; expanded: boolean; editorFirst?: boolean; chat: React.ReactNode; workspace: React.ReactNode }) {
  const mobile = useIsMobile();
  const { setOpen: setSidebarOpen } = useSidebar();
  const full = visible && (mobile || expanded);
  const host = React.useRef<HTMLDivElement>(null);
  const pane = React.useRef<PanelImperativeHandle>(null);
  const widthKey = `tributary.workspaceWidth.${encodeURIComponent(project || '')}`;
  const saved = React.useMemo(() => ({ chat: savedWidth(`${widthKey}.chat`) ?? savedWidth('tributary.panelWidth'), editor: savedWidth(`${widthKey}.editor`) ?? savedWidth('tributary.editorPanelWidth') }), [widthKey]);
  const [available, setAvailable] = React.useState(0);
  React.useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (visible && !mobile && !expanded && available > 0 && available < 680) setSidebarOpen(false);
  }, [visible, mobile, expanded, available, setSidebarOpen]);
  React.useEffect(() => {
    if (!available) return;
    const preferred = editorFirst ? saved.editor ?? available * .74 : saved.chat ?? Math.min(640, available * .56);
    const target = !visible ? 0 : full ? available : Math.min(Math.max(320, preferred), Math.max(0, available - 360));
    pane.current?.resize(target);
  }, [visible, full, available, editorFirst, saved]);
  const reset = () => {
    const width = Math.min(editorFirst ? available * .74 : Math.min(640, available * .56), Math.max(0, available - 360));
    saved[editorFirst ? 'editor' : 'chat'] = width;
    try { localStorage.setItem(`${widthKey}.${editorFirst ? 'editor' : 'chat'}`, String(Math.round(width))); } catch { /* optional */ }
    pane.current?.resize(width);
  };
  const chatPane = <ResizablePanel key="chat" id="conversation-pane" defaultSize="100%" minSize={full ? 0 : visible ? 360 : 0} maxSize={full ? 0 : '100%'} className="h-full min-w-0">
    <div className={full ? 'hidden' : 'flex h-full min-h-0 flex-col'}>{chat}</div>
  </ResizablePanel>;
  const handle = <ResizableHandle key="separator" aria-label="Resize workspace" title="Arrow keys resize; Enter resets" onDoubleClick={reset} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); reset(); } }} className={!visible || full ? 'hidden' : 'max-md:hidden'} />;
  const workspacePane = <ResizablePanel key="workspace" id="workspace-pane" panelRef={pane} defaultSize={0} minSize={!visible ? 0 : full ? '100%' : 320} maxSize={!visible ? 0 : '100%'} className="h-full min-w-0">
    <div className={visible ? 'h-full min-h-0' : 'hidden'}>{workspace}</div>
  </ResizablePanel>;
  return <ResizablePanelGroup elementRef={host} id="conversation-workspace" className="min-h-0 min-w-0 flex-1" disabled={!visible || full}
    onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction || !visible || full) return;
      const width = layout['workspace-pane'] * (available - 1) / 100;
      if (width) {
        saved[editorFirst ? 'editor' : 'chat'] = width;
        try { localStorage.setItem(`${widthKey}.${editorFirst ? 'editor' : 'chat'}`, String(Math.round(width))); } catch { /* optional */ }
      }
    }}>
    {editorFirst ? [workspacePane, handle, chatPane] : [chatPane, handle, workspacePane]}
  </ResizablePanelGroup>;
}
