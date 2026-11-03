import * as React from 'react';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { DeveloperEntry, DeveloperRail } from '@/components/developer-rail';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { CommandPalette } from '@/components/command-palette';
import { LiveActivity } from '@/components/live-activity';
import { Composer, HandoffHint } from '@/components/composer';
import { Conversation } from '@/components/conversation';
import { NoProject, Starters } from '@/components/empty-states';
import { SettingsDialog } from '@/components/settings-dialog';
import { TeamDialog } from '@/components/team-dialog';
import { ThreadHeader } from '@/components/thread-header';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useStore } from '@/store';
import { TaskHome } from '@/components/task-home';
import { DocumentPanel } from '@/components/document-panel';
import { CollaborationDialog } from '@/components/collaboration-dialog';
import { ProjectContext } from '@/components/project-context';
const WorkspacePanel = React.lazy(() => import('@/components/workspace-panel').then((m) => ({ default: m.WorkspacePanel })));
const TerminalPanel = React.lazy(() => import('@/components/terminal-panel').then((m) => ({ default: m.TerminalPanel })));

function NewThread() {
  const s = useStore(); const project = s.st?.projects.find((p) => p.path === s.project);
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8">
      <div className="mx-auto my-auto w-full max-w-3xl py-8">
        <p className="mb-3 break-words text-center text-sm text-muted-foreground">{project?.name || 'Your project'}</p>
        <h2 className="mb-8 text-center text-3xl font-medium text-balance">What can I help you with?</h2>
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
  const { open, isMobile } = useSidebar();
  return <nav aria-label="Main navigation" inert={studio && !open && !isMobile} className={fullscreen ? "contents max-md:hidden" : "contents"}><AppSidebar /></nav>;
}

export default function App() {
  const s = useStore();
  // Once opened, the terminal stays mounted (hidden when closed) so its shells and scrollback survive.
  const [terminalKept, setTerminalKept] = React.useState(false);
  React.useEffect(() => { if (s.terminalOpen) setTerminalKept(true); }, [s.terminalOpen]);
  const [workspaceOpened, setWorkspaceOpened] = React.useState(false);
  React.useEffect(() => { if (s.panel.open) setWorkspaceOpened(true); }, [s.panel.open]);
  const studio = !!s.codeLayout && !s.document;
  const conversationLayout = !studio && !s.home && !!s.thread?.messages.length && !s.thread.task;
  const workspaceVisible = !s.document && s.panel.open && !!s.project;
  React.useEffect(() => { document.title = s.thread ? `${s.thread.title} · Tributary` : 'Tributary'; }, [s.thread?.title]);
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider style={conversationLayout ? { '--sidebar-width': '18rem' } as React.CSSProperties : undefined} className={studio ? "developer-shell h-svh overflow-hidden" : conversationLayout ? "conversation-shell h-svh overflow-hidden" : "h-svh overflow-hidden"}>
        <DeveloperEntry />
        {studio && <DeveloperRail />}
        <ProjectNavigation studio={studio} fullscreen={workspaceVisible} />
        <KeyboardShortcuts />
        <SidebarInset className="min-h-0 overflow-hidden">
          {!studio && <div className={workspaceVisible ? "contents max-md:hidden" : "contents"}><ThreadHeader /></div>}
          <div className="flex min-h-0 flex-1">
            <WorkspaceLayout visible={workspaceVisible} expanded={s.workspaceExpanded} editorFirst={studio}
              chat={<>{studio && <ThreadHeader compact />}<section aria-label="Chat" className="flex min-h-0 flex-1 flex-col"><Main /></section>
                {s.project && (s.terminalOpen || terminalKept) && <React.Suspense fallback={<p role="status" className="p-3 text-sm text-muted-foreground">Opening terminal…</p>}><TerminalPanel hidden={!s.terminalOpen} /></React.Suspense>}</>}
              workspace={(workspaceOpened || s.panel.open) && <React.Suspense fallback={<p role="status" className="p-5 text-sm text-muted-foreground">Opening workspace…</p>}><WorkspacePanel /></React.Suspense>}
            />
            <DocumentPanel />
            {conversationLayout && !workspaceVisible && !s.document && <ProjectContext />}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
      <TeamDialog />
      <CollaborationDialog />
      <CommandPalette />
      <LiveActivity />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
