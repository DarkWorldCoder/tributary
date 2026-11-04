import { usePackIcon } from '@/lib/extension-appearance';
import { Folder, FolderArchive, FolderBookmark, FolderCheck, FolderCode, FolderCog, FolderGit2, FolderOpen, FolderKanban, Images, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const folders: Record<string, LucideIcon> = {
  src: FolderCode, source: FolderCode, app: FolderCode, lib: FolderCode, core: FolderCode,
  components: FolderKanban, ui: FolderKanban, pages: FolderKanban, routes: FolderKanban,
  assets: Images, images: Images, public: Images, media: Images,
  test: FolderCheck, tests: FolderCheck, __tests__: FolderCheck, e2e: FolderCheck,
  config: FolderCog, '.config': FolderCog, '.vscode': FolderCog, '.github': FolderGit2, '.git': FolderGit2,
  docs: FolderBookmark, documentation: FolderBookmark, node_modules: FolderArchive, vendor: FolderArchive, dist: FolderArchive, build: FolderArchive,
};

export function FolderTypeIcon({ path, open = false, className }: { path: string; open?: boolean; className?: string }) {
  const custom = usePackIcon(path, true, open, className);
  if (custom) return custom;
  const name = path.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? '';
  const Icon = open ? FolderOpen : folders[name] ?? Folder;
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', open && 'text-foreground/80', className)} />;
}
