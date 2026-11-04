import { ChevronDown, Globe, ListTodo, MessageSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
export type TaskMode = 'ask' | 'plan' | 'research';
const modes = { ask: { label: 'Ask', hint: 'Use selected file permissions', icon: MessageSquare }, plan: { label: 'Plan', hint: 'Review before building · read-only', icon: ListTodo }, research: { label: 'Deep research', hint: 'Web sources and a cited report · read-only', icon: Globe } };
export function TaskModePicker({ value, onChange, compact, researchAvailable }: { value: TaskMode; onChange: (mode: TaskMode) => void; compact: boolean; researchAvailable: boolean }) {
  const current = modes[value]; const Icon = current.icon;
  return <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><InputGroupButton size="sm" aria-label={`Task mode: ${current.label}`} className={cn('composer-selector rounded-full', compact && 'composer-selector-icon [&>span]:hidden [&>svg:last-child]:hidden', value !== 'ask' && 'text-foreground')}><Icon /><span className="composer-selector-label">{current.label}</span><ChevronDown className="composer-selector-chevron" /></InputGroupButton></DropdownMenuTrigger></TooltipTrigger><TooltipContent>{current.label}</TooltipContent></Tooltip>
    <DropdownMenuContent align="start" side="top" className="w-72"><DropdownMenuLabel>Task mode</DropdownMenuLabel><DropdownMenuRadioGroup value={value} onValueChange={(mode) => onChange(mode as TaskMode)}>{(Object.keys(modes) as TaskMode[]).map((mode) => { const item = modes[mode]; const Mark = item.icon; return <DropdownMenuRadioItem key={mode} value={mode} disabled={mode === 'research' && !researchAvailable} className="items-start"><Mark className="mt-0.5 size-4 shrink-0" /><span><span className="block">{item.label}</span><span className="block text-xs text-muted-foreground">{mode === 'research' && !researchAvailable ? 'Choose an agent with web tools' : item.hint}</span></span></DropdownMenuRadioItem>; })}</DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>;
}
