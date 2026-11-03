import * as React from 'react';
import { Check, ChevronDown, MessageSquare, Plus } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useStore } from '@/store';
import type { ThreadSummary } from '@/types';

/** Project chats stay reachable from the workbench's chat pane. */
export function ChatSwitcher({ title }: { title: string }) {
  const s = useStore(); const [open, setOpen] = React.useState(false);
  const [chats, setChats] = React.useState<ThreadSummary[]>([]); const [error, setError] = React.useState('');
  const request = React.useRef(0);
  const changeOpen = (value: boolean) => {
    setOpen(value); const n = ++request.current;
    if (!value || !s.project) return;
    setError(''); setChats(s.threadsBy[s.project] || []);
    s.loadThreads(s.project).then((rows) => { if (request.current === n) setChats(rows); }).catch(() => { if (request.current === n) setError('Could not refresh chats.'); });
  };
  React.useEffect(() => { setOpen(false); request.current++; }, [s.project]);
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><button aria-label="Switch conversation" className="flex max-w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span className="truncate">{title}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] p-0"><Command>
      <CommandInput placeholder="Find a project chat…" aria-label="Search project chats" />
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      <CommandList className="max-h-80"><CommandEmpty>No matching chats.</CommandEmpty><CommandGroup heading="Project chats">
        {chats.map((chat) => <CommandItem key={chat.id} value={`${chat.title} ${chat.id}`} onSelect={() => { changeOpen(false); void s.openThread(chat.id); }} className="gap-2 py-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{chat.title}</span>{chat.running && <span className="text-xs text-muted-foreground">Working</span>}{chat.id === s.thread?.id && <Check className="size-4" />}
        </CommandItem>)}
      </CommandGroup><CommandGroup><CommandItem onSelect={() => { changeOpen(false); s.newThread(); }}><Plus className="size-4" />New chat</CommandItem></CommandGroup></CommandList>
    </Command></PopoverContent>
  </Popover>;
}
