import * as React from 'react';
import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, ShieldQuestion, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { AppNotification } from '@/types';

const ICON = { done: <CircleCheck className="text-success" />, failed: <CircleAlert className="text-destructive" />, attention: <CircleAlert className="text-warning" />, permission: <ShieldQuestion className="text-brand" />, info: <Info className="text-muted-foreground" /> };

/** In-app notification center: finished turns, failures, permission requests, team and race results. */
export function NotificationsBell() {
  const s = useStore(); const [open, setOpen] = React.useState(false); const [list, setList] = React.useState<AppNotification[]>([]);
  const unread = s.st?.unread ?? 0;
  const load = React.useCallback(() => s.hub.call<AppNotification[]>('notifications').then(setList).catch(() => setList([])), [s.hub]);
  React.useEffect(() => { if (open) load(); }, [open, load, unread]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell />{unread > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">{unread > 9 ? '9+' : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="flex-1 font-semibold">Notifications</span>
          <Button size="xs" variant="ghost" disabled={!unread} onClick={async () => { await s.hub.call('markRead'); load(); }}><CheckCheck /> Mark all read</Button>
          <Button size="icon-xs" variant="ghost" aria-label="Clear notifications" disabled={!list.length} onClick={async () => { await s.hub.call('clearNotifications'); load(); }}><Trash2 /></Button>
        </div>
        <ul className="max-h-[60vh] overflow-auto py-1" aria-live="polite">
          {list.map((n) => (
            <li key={n.id}>
              <button className={cn('flex w-full gap-2.5 px-3 py-2 text-left hover:bg-muted/60 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', !n.read && 'bg-brand/5')}
                onClick={async () => { await s.hub.call('markRead', n.id); if (n.threadId) s.openThread(n.threadId); setOpen(false); }}>
                {ICON[n.kind] ?? ICON.info}
                <span className="min-w-0 flex-1"><span className={cn('block text-sm', !n.read && 'font-semibold')}>{n.title}</span>{n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{ago(n.ts)}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-8 text-center text-sm text-muted-foreground">You’re all caught up. Finished turns, failures and team results show up here.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
