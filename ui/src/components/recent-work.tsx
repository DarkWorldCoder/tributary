import * as React from 'react';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileTypeIcon } from '@/components/file-type-icon';
import { readRecentFiles } from '@/lib/recent-work.mjs';
import { useStore } from '@/store';
import type { Thread } from '@/types';

export function RecentWork() {
  const s = useStore(); const projects = (s.st?.projects || []).filter((p) => p.kind !== 'personal');
  const files = React.useMemo(() => readRecentFiles().filter((file) => projects.some((p) => p.path === file.project)), [s.recentOpen, s.st?.projects]);
  return <CommandDialog open={s.recentOpen} onOpenChange={s.setRecentOpen} title="Open recent" description="Find project folders and recently opened files.">
    <CommandInput placeholder="Find a folder or file…" aria-label="Search recent work" /><CommandList><CommandEmpty>No matching recent work.</CommandEmpty>
      <CommandGroup heading="Project folders">{projects.map((project) => <CommandItem key={project.path} value={`${project.name} ${project.path}`} onSelect={() => { s.setRecentOpen(false); s.newThread(project.path); s.openPanel('files'); }}><FolderOpen /><span className="truncate">{project.name}</span><span className="ml-auto max-w-40 truncate text-xs text-muted-foreground">{project.path}</span></CommandItem>)}</CommandGroup>
      <CommandGroup heading="Recent files">{files.map((file) => <CommandItem key={`${file.project}:${file.threadId}:${file.rel}`} value={`${file.project} ${file.rel} ${file.threadId || ''}`} onSelect={() => { void (async () => { s.setRecentOpen(false); const thread = file.threadId ? await s.hub.call<Thread | null>('thread', file.threadId) : null; if (thread?.project === file.project) await s.openThread(thread.id); else s.newThread(file.project); s.openFile(file.rel); })().catch((e: Error) => toast.error(e.message)); }}><FileTypeIcon path={file.rel} /><span className="truncate">{file.rel}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{projects.find((p) => p.path === file.project)?.name}</span></CommandItem>)}</CommandGroup>
    </CommandList>
  </CommandDialog>;
}
