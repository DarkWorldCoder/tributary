import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ProjectRoom } from '@/components/project-room';
import { useStore } from '@/store';
import { toast } from 'sonner';
import type { RoomTask } from '../../../core/collaboration/client.mjs';

export function CollaborationDialog() {
  const s = useStore();
  const projects = (s.st?.projects || []).filter((p) => p.kind !== 'personal');
  const links = (s.st?.settings.roomFolders || {}) as Record<string, string>;
  const taskPrompt = (task: RoomTask) => `Shared task: ${task.title}\n\n${task.description}\n\nUse a separate working copy for this task. Report changed files and actual checks. Update the project room with your result.`;
  const prepare = (path: string, task?: RoomTask) => {
    if (!projects.some((p) => p.path === path)) throw new Error('Choose a local project folder first.');
    const agent = task && s.ready.find((a) => a.name === task.agent);
    if (agent) s.setAgentId(agent.id);
    s.newThread(path);
    if (task) s.setDraft(taskPrompt(task));
    s.setRoomOpen(false);
  };
  return <Dialog open={s.roomOpen} onOpenChange={s.setRoomOpen}>
    <DialogContent className="flex h-[min(850px,94vh)] w-[min(1120px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none [&>button]:hidden">
      <DialogTitle className="sr-only">Shared project room</DialogTitle>
      <DialogDescription className="sr-only">Host, join and coordinate team projects.</DialogDescription>

      <ProjectRoom onClose={() => s.setRoomOpen(false)} canHost={s.hub.platform === 'desktop'} bridge={s.hub} agents={s.ready.filter((a) => !a.connectionId)} localProjects={projects} initialProjectPath={s.project} folderLinks={links}
        onLinkProject={async (endpoint, projectId, path) => {
          if (!projects.some((p) => p.path === path)) throw new Error('Choose a registered local project.');
          await s.hub.call('setSettings', { roomFolders: { ...links, [JSON.stringify([endpoint, projectId])]: path } });
          await s.refreshState();
        }}
        onUseTask={(task, path) => { if (path) prepare(path, task); }}
        onOpenAgents={(path, task) => {
          if (!s.ready.length) { toast.error('Connect an agent first.'); return; }
          prepare(path, task); s.setTeamOpen(true);
        }}
        onOpenActivity={() => { s.setRoomOpen(false); window.dispatchEvent(new Event('tributary:live')); }}
      />
    </DialogContent>
  </Dialog>;
}
