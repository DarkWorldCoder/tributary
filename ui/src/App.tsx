import { ExtensionAppearance } from '@/lib/extension-appearance';
import { DebugWorkbenchProvider } from '@/components/debug-workbench';
import { TerminalHost } from '@/components/terminal-host';
import { DesktopTitlebar } from '@/components/desktop-titlebar';
import * as React from 'react';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { DeveloperEntry, DeveloperRail } from '@/components/developer-rail';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { CommandPalette } from '@/components/command-palette';
import { ProjectSearchLauncher } from '@/components/project-search';
import { QuickOpen } from '@/components/quick-open';
import { LiveActivity } from '@/components/live-activity';
import { Composer, HandoffHint } from '@/components/composer';
import { Conversation } from '@/components/conversation';
import { NoProject, Starters } from '@/components/empty-states';
import { ThreadHeader } from '@/components/thread-header';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useStore } from '@/store';
import { TaskHome } from '@/components/task-home';
import { ProjectContext } from '@/components/project-context';
import { RecentWork } from '@/components/recent-work';
import { DeferredSurface } from '@/components/deferred-surface';
import { AppUpdateNotice } from '@/components/app-updates';
const SettingsDialog = React.lazy(() => import('@/components/settings-dialog').then((module) => ({ default: module.SettingsDialog })));
const TeamDialog = React.lazy(() => import('@/components/team-dialog').then((module) => ({ default: module.TeamDialog })));
const CollaborationDialog = React.lazy(() => import('@/components/collaboration-dialog').then((module) => ({ default: module.CollaborationDialog })));
const DocumentPanel = React.lazy(() => import('@/components/document-panel').then((module) => ({ default: module.DocumentPanel })));
const WorkspacePanel = React.lazy(() => import('@/components/workspace-panel').then((m) => ({ default: m.WorkspacePanel })));


function NewThread() {
  const s = useStore(); const project = s.st?.projects.find((p) => p.path === s.project);
  return (
    <div className="@container flex min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-5">
      <div className="mx-auto my-auto w-full max-w-3xl py-8">
        <img src="./logo.svg" alt="Tributary" className="mx-auto mb-4 size-8 rounded-lg" />
        <p className="mb-2 break-words text-center text-xs text-muted-foreground">{project?.name || 'Your project'}</p>
        <h2 className="mb-6 text-center text-xl font-medium text-balance @min-[480px]:text-3xl">What can I help you with?</h2>
        <Composer autoFocus />
        <Starters />
      </div>
    </div>
  );
}

function Main() {
  const s = useStore();
  if (!s.loaded) return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  if (s.home || !s.project || (!s.thread && s.st?.projects.find((p) => p.path === s.project)?.kind === 'personal')) return <TaskHome />;
  if (!s.thread || !s.thread.messages.length) return <NewThread />;
  return (
    <>
      <Conversation />
      <div className={s.codeLayout ? "shrink-0 px-3 pb-3" : "shrink-0 px-3 pb-3 sm:px-6 sm:pb-4"}><div className="chat-composer-host mx-auto max-w-3xl"><Composer autoFocus />{!s.codeLayout && s.thread?.task && <HandoffHint />}</div></div>
    </>
  );
}

function ProjectNavigation({ studio, fullscreen }: { studio: boolean; fullscreen: boolean }) {
  const s = useStore();
  const { open, isMobile, setOpen } = useSidebar();
  const navigation = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!studio || !open || isMobile) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element) || navigation.current?.contains(target)) return;
      // Keep the toggle and portalled sidebar menus/dialogs usable. Outside clicks
      // still reach the editor, chat or terminal that the user clicked.
      if (target.closest('[aria-label="Projects and chats"], [aria-label="Toggle project list"], [aria-label="Toggle project sidebar"], [data-slot="sidebar-trigger"], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [studio, open, isMobile, setOpen]);
  return <nav ref={navigation} data-slot="project-navigation" aria-label="Main navigation" inert={fullscreen && s.workspaceExpanded || studio && !open && !isMobile} className={fullscreen ? "contents max-md:hidden" : "contents"}><AppSidebar /></nav>;
}

function WorkbenchApp() {
  const s = useStore();
  // Once opened, the terminal stays mounted (hidden when closed) so its shells and scrollback survive.
  const [terminalKept, setTerminalKept] = React.useState(false);
  React.useEffect(() => { if (s.terminalOpen) setTerminalKept(true); }, [s.terminalOpen]);
  const [workspaceOpened, setWorkspaceOpened] = React.useState(false);
  React.useEffect(() => { if (s.panel.open) setWorkspaceOpened(true); }, [s.panel.open]);
  const studio = !!s.codeLayout && !s.document;
  const conversationLayout = !studio && !s.home && !!s.thread?.messages.length && !s.thread.task;
  const workspaceVisible = !s.home && !s.document && s.panel.open && !!s.project;
  React.useEffect(() => { document.title = s.thread ? `${s.thread.title} · Tributary` : 'Tributary'; }, [s.thread?.title]);
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider style={conversationLayout ? { '--sidebar-width': '18rem' } as React.CSSProperties : undefined} className={studio ? "developer-shell app-frame h-svh overflow-hidden" : conversationLayout ? "conversation-shell app-frame h-svh overflow-hidden" : "app-frame h-svh overflow-hidden"}>
        <DesktopTitlebar />
        <DeveloperEntry />
        {studio && <DeveloperRail workspaceVisible={workspaceVisible} />}
        <ProjectNavigation studio={studio} fullscreen={workspaceVisible} />
        <KeyboardShortcuts />
        <SidebarInset className="min-h-0 overflow-hidden">
          {!studio && <div className={workspaceVisible ? "contents max-md:hidden" : "contents"}><ThreadHeader /></div>}
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1">
            <WorkspaceLayout project={s.workdir} visible={workspaceVisible} expanded={s.workspaceExpanded} editorFirst={studio}
              chat={<>{studio && <ThreadHeader compact />}<section aria-label="Chat" className="flex min-h-0 flex-1 flex-col"><Main /></section></>}
              workspace={<div data-slot="editor-terminal-area" className={`${s.workspaceExpanded && workspaceVisible ? 'fixed inset-0 z-40' : 'relative'} flex h-full min-h-0 min-w-0 ${s.terminalDock === 'left' || s.terminalDock === 'right' ? 'flex-row' : 'flex-col'}`}>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{(workspaceOpened || s.panel.open) && <React.Suspense fallback={<p role="status" className="p-5 text-sm text-muted-foreground">Opening workspace…</p>}><WorkspacePanel /></React.Suspense>}</div>
                {s.project && (s.terminalOpen || terminalKept) && <TerminalHost hidden={!s.terminalOpen || !workspaceVisible} close={() => s.setTerminalOpen(false)} />}
              </div>}
            />
            <DeferredSurface active={!!s.document} name="Document"><DocumentPanel /></DeferredSurface>
            {conversationLayout && !workspaceVisible && !s.document && <ProjectContext />}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <DeferredSurface active={s.settings.open} name="Settings" close={() => s.setSettings({ ...s.settings, open: false })}><SettingsDialog /></DeferredSurface>
      <AppUpdateNotice />
      <DeferredSurface active={s.teamOpen} name="Agent teams" close={() => s.setTeamOpen(false)}><TeamDialog /></DeferredSurface>
      <DeferredSurface active={s.roomOpen} name="Project room" close={() => s.setRoomOpen(false)}><CollaborationDialog /></DeferredSurface>
      <CommandPalette />
      <ProjectSearchLauncher />
      <QuickOpen />
      <RecentWork />
      <LiveActivity />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}

export default function App() { return <ExtensionAppearance><DebugWorkbenchProvider><WorkbenchApp /></DebugWorkbenchProvider></ExtensionAppearance>; }
