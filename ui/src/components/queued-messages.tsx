import * as React from 'react';
import { Clock, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store';
export function QueuedMessages() {
  const s = useStore(); const [editing, setEditing] = React.useState<string | null>(null); const [text, setText] = React.useState('');
  if (!s.queued.length) return null;
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="mb-1 h-7 max-w-full justify-start gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Queued messages"><Clock className="size-3.5" /><span className="truncate">{s.queued.length} queued</span></Button></PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-[min(380px,calc(100vw-2rem))] p-2"><div className="mb-1 flex items-center justify-between px-1 text-xs font-medium"><span>Queued messages</span><Button size="xs" variant="ghost" onClick={s.clearQueue}>Clear all</Button></div><ul className="max-h-80 space-y-1 overflow-auto">{s.queued.map((message, index) => <li key={message.id} className="rounded-md border p-2">
      <div className="flex min-w-0 items-center gap-1 text-xs"><span className="min-w-0 flex-1 truncate text-muted-foreground">{s.agentOf(message.agentId).name}{message.attachments?.length ? ` · ${message.attachments.length} attached` : ''}</span><Button size="icon-xs" variant="ghost" aria-label={`Edit queued message ${index + 1}`} onClick={() => { setEditing(message.id); setText(message.text); }}><Pencil /></Button><Button size="icon-xs" variant="ghost" aria-label={`Remove queued message ${index + 1}`} onClick={() => s.removeQueued(message.id)}><Trash2 /></Button></div>
      {editing === message.id ? <div className="mt-1 space-y-2"><Textarea autoFocus aria-label="Queued message text" value={text} onChange={(event) => setText(event.target.value)} className="min-h-20 text-[13px]" /><div className="flex justify-end gap-1"><Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button size="xs" disabled={!text.trim()} onClick={() => { s.editQueued(message.id, text); setEditing(null); }}>Save</Button></div></div> : <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px]">{message.text}</p>}
    </li>)}</ul></PopoverContent>
  </Popover>;
}
