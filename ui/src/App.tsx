import * as React from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agent-avatar';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { Composer, HandoffHint } from '@/components/composer';
import { Conversation } from '@/components/conversation';
import { NoProject, Starters } from '@/components/empty-states';
import { SettingsDialog } from '@/components/settings-dialog';
import { TeamDialog } from '@/components/team-dialog';
import { TerminalPanel } from '@/components/terminal-panel';
import { ThreadHeader } from '@/components/thread-header';
import { WorkspacePanel } from '@/components/workspace-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import { TaskHome } from '@/components/task-home';
import { DocumentPanel } from '@/components/document-panel';
import { CollaborationDialog } from '@/components/collaboration-dialog';

function NewThread() {
  const s = useStore(); const project = s.st?.projects.find((p) => p.path === s.project);
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[10vh]">
      <div className="w-full max-w-2xl">
        <h2 className="mb-1.5 text-center text-[1.65rem] font-semibold tracking-tight text-balance">What should we work on in {project?.name}?</h2>
        <p className="mb-6 text-center text-muted-foreground text-pretty">Start with any agent. Switch whenever you like, and the next one gets the context.</p>
        <Composer autoFocus />
        <div className="mt-4 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Agent">
          {s.ready.map((a) => (
            <button key={a.id} role="radio" aria-checked={a.id === s.agentId} onClick={() => s.setAgentId(a.id)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-3 pl-1 text-sm transition-colors hover:bg-muted/60', a.id === s.agentId && 'border-foreground/40 bg-muted')}>
              <AgentAvatar agent={a} size="sm" />{a.name}
            </button>
          ))}
        </div>
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
      <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4"><div className="mx-auto max-w-3xl"><Composer autoFocus /><HandoffHint /></div></div>
    </>
  );
}

export default function App() {
  const s = useStore();
  // Once opened, the terminal stays mounted (hidden when closed) so its shells and scrollback survive.
  const [terminalKept, setTerminalKept] = React.useState(false);
  React.useEffect(() => { if (s.terminalOpen) setTerminalKept(true); }, [s.terminalOpen]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const dialogOpen = !!document.querySelector('[role="dialog"]');
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); s.setPalette(!s.palette); }
      else if (mod && e.key === ',') { e.preventDefault(); s.openSettings('appearance'); }
      else if (mod && e.key.toLowerCase() === 'n' && s.project) { e.preventDefault(); s.newThread(); }
      else if (mod && e.key === '`' && s.project) { e.preventDefault(); s.setTerminalOpen(!s.terminalOpen); }
      else if (mod && e.key.toLowerCase() === 'j' && s.project) { e.preventDefault(); s.setPanel({ ...s.panel, open: !s.panel.open }); }
      else if (e.key === 'Escape' && s.panel.open && !dialogOpen && !s.palette && !(e.target as HTMLElement)?.closest?.('.cm-editor, .xterm')) s.setPanel({ ...s.panel, open: false });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [s]);
  React.useEffect(() => { document.title = s.thread ? `${s.thread.title} · Tributary` : 'Tributary'; }, [s.thread?.title]);
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          <ThreadHeader />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="flex min-h-0 flex-1 flex-col">{<Main />}</main>
              {s.project && (s.terminalOpen || terminalKept) && <TerminalPanel hidden={!s.terminalOpen} />}
            </div>
            {!s.document && s.panel.open && s.project && <WorkspacePanel />}
            <DocumentPanel />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
      <TeamDialog />
      <CollaborationDialog />
      <CommandPalette />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
