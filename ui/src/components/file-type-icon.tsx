import { Atom, Box, Braces, CodeXml, Container, Database, File, FileArchive, FileAudio, FileCode2, FileImage, FileKey, FileSpreadsheet, FileTerminal, FileText, FileVideo, GitBranch, Network, Package, Palette, Presentation, Settings2, ShieldCheck, Triangle, Type, type LucideIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { fileKind, type FileKind } from '@/lib/file-kind.mjs';
import { cn } from '@/lib/utils';

const icons: Partial<Record<FileKind, [LucideIcon, string?]>> = {
  javascript: [FileCode2, 'text-amber-500 dark:text-amber-300'], typescript: [FileCode2, 'text-blue-600 dark:text-blue-400'], code: [FileCode2],
  json: [Braces, 'text-amber-600 dark:text-amber-400'], markup: [CodeXml, 'text-orange-600 dark:text-orange-400'], style: [Palette],
  markdown: [FileText, 'text-blue-600 dark:text-blue-400'], image: [FileImage, 'text-emerald-600 dark:text-emerald-400'],
  audio: [FileAudio], video: [FileVideo], archive: [FileArchive], document: [FileText], sheet: [FileSpreadsheet],
  presentation: [Presentation], config: [Settings2], terminal: [FileTerminal], database: [Database], font: [Type],
  binary: [Package], lock: [FileKey], container: [Container], git: [GitBranch], file: [File],
  react: [Atom, 'text-cyan-700 dark:text-cyan-400'], vue: [Triangle, 'text-emerald-700 dark:text-emerald-400'],
  package: [Package, 'text-orange-700 dark:text-orange-400'], certificate: [ShieldCheck], graph: [Network], model: [Box], data: [Database],
};
// Language initials stay legible at 16 px without loading a separate icon font.
const languages: Partial<Record<FileKind, [string, string]>> = {
  javascript: ['JS', 'text-amber-700 dark:text-amber-300'], typescript: ['TS', 'text-blue-700 dark:text-blue-400'],
  python: ['Py', 'text-blue-700 dark:text-blue-300'], rust: ['Rs', 'text-orange-800 dark:text-orange-300'],
  go: ['Go', 'text-cyan-700 dark:text-cyan-400'], java: ['Jv', 'text-orange-700 dark:text-orange-400'],
  kotlin: ['Kt', 'text-violet-700 dark:text-violet-300'], c: ['C', 'text-blue-700 dark:text-blue-300'],
  cpp: ['C+', 'text-blue-700 dark:text-blue-300'], csharp: ['C#', 'text-violet-700 dark:text-violet-300'],
  swift: ['Sw', 'text-orange-700 dark:text-orange-400'], ruby: ['Rb', 'text-red-700 dark:text-red-400'],
  php: ['php', 'text-indigo-700 dark:text-indigo-300'], svelte: ['Sv', 'text-orange-700 dark:text-orange-400'],
};

export function FileTypeIcon({ path, loading = false, className }: { path: string; loading?: boolean; className?: string }) {
  const kind = fileKind(path); const language = languages[kind];
  const [Icon, color] = icons[kind] ?? icons.file!;
  if (loading) return <Spinner aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
  if (language) return <svg aria-hidden="true" data-file-kind={kind} viewBox="0 0 20 20" className={cn('size-4 shrink-0', language[1], className)}><rect x="1" y="1" width="18" height="18" rx="3" fill="currentColor" opacity=".1" /><text x="10" y="13.5" textAnchor="middle" fill="currentColor" fontFamily="var(--font-mono)" fontWeight="600" fontSize={language[0].length > 2 ? '8' : '10'}>{language[0]}</text></svg>;
  return <Icon aria-hidden="true" data-file-kind={kind} className={cn('size-4 shrink-0 text-muted-foreground', color, className)} />;
}
