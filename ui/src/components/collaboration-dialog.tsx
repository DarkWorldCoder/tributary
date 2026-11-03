import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ProjectRoom } from '@/components/project-room';
import { useStore } from '@/store';
import { toast } from 'sonner';

export function CollaborationDialog() {
  const s = useStore();
  return <Dialog open={s.roomOpen} onOpenChange={s.setRoomOpen}><DialogContent className="flex h-[min(850px,94vh)] w-[min(1120px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none [&>button]:hidden"><DialogTitle className="sr-only">Shared project room</DialogTitle><DialogDescription className="sr-only">Coordinate tasks and progress with teammates and their agents.</DialogDescription><div className="flex justify-end border-b px-3 py-1"><button className="rounded px-2 py-1 text-xs max-sm:min-h-11 text-muted-foreground hover:bg-muted" onClick={() => s.setRoomOpen(false)}>Back to workspace</button></div><ProjectRoom bridge={s.hub} agents={s.ready.filter((a) => !a.connectionId)} onUseTask={(task) => {
    if (!s.project || s.st?.projects.find((p) => p.path === s.project)?.kind === 'personal') { toast.error('Open a local project folder first.'); return; }
    const agent = s.ready.find((a) => a.name === task.agent); if (agent) s.setAgentId(agent.id);
    s.newThread(s.project); s.setDraft(`Shared task: ${task.title}\n\n${task.description}\n\nUse a separate working copy for this task. Report the changed files and actual checks performed. Update the project room with the result when finished.`); s.setRoomOpen(false);
  }} /></DialogContent></Dialog>;
}
