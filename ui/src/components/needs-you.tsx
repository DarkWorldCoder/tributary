import * as React from 'react';
import { toast } from 'sonner';
import { CircleAlert, MessageSquareWarning, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/store';
import { ShortcutLabel } from '@/components/shortcut-settings';

// What needs you across every project (hub.attention): approvals, failures (a turn or its checks), and finished work
// you have not looked at, most urgent first. The chip jumps to the next one, and so does Mod+Shift+J.
interface Item { threadId: string; project: string; title: string; status: 'permission' | 'failed' | 'review' }
const VERB = { permission: 'waiting for your OK', failed: 'failed', review: 'has changes to review' };
const ICON = { permission: ShieldQuestion, failed: CircleAlert, review: MessageSquareWarning };

export function NeedsYou() {
  const s = useStore(); const [list, setList] = React.useState<Item[]>([]);
  const current = s.thread?.id;
  const others = list.filter((x) => x.threadId !== current);
  const next = React.useRef<() => void>(() => {});
  next.current = () => { const target = others[0]; if (target) s.openThread(target.threadId); else toast('Nothing needs you right now'); };
  React.useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { clearTimeout(timer); timer = setTimeout(() => { s.hub.call<Item[]>('attention').then((a) => { if (alive) setList(a || []); }).catch(() => {}); }, 250); };
    load();
    const offs = [s.hub.on('threads', load), s.hub.on('running', load), s.hub.on('notification', load)];
    const jump = () => next.current();
    window.addEventListener('tributary:next-attention', jump);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('tributary:next-attention', jump); for (const off of offs) if (typeof off === 'function') off(); };
  }, [s.hub]);
  React.useEffect(() => { if (current) setList((l) => l.filter((x) => !(x.threadId === current && x.status === 'review'))); }, [current]);
  if (!others.length) return null;
  const Icon = ICON[others[0].status];
  return (
    <Tooltip><TooltipTrigger asChild>
      <Button variant="outline" onClick={() => next.current()} aria-label={`${others.length} ${others.length === 1 ? 'chat needs' : 'chats need'} you. Open "${others[0].title}"`}
        className="fixed right-4 bottom-36 z-40 h-9 max-w-80 gap-2 rounded-full border-brand/40 bg-popover pr-3 pl-2.5 shadow-md">
        <Icon className={others[0].status === 'failed' ? 'text-destructive' : 'text-brand'} />
        <span className="truncate">{others.length === 1 ? `${others[0].title} ${VERB[others[0].status]}` : `${others.length} chats need you`}</span>
      </Button>
    </TooltipTrigger><TooltipContent side="left" className="max-w-80">
      <ul className="space-y-0.5">{others.slice(0, 6).map((x) => <li key={x.threadId}>{x.title}: {VERB[x.status]}</li>)}</ul>
      <p className="mt-1 opacity-70">Next chat <ShortcutLabel action="attention" /></p>
    </TooltipContent></Tooltip>
  );
}

/** Settings: system notifications only when blocked (or for finished turns too), and keeping the computer awake. */
export function AttentionSettings() {
  const s = useStore(); const settings = (s.st?.settings || {}) as { notifyDone?: boolean; keepAwake?: boolean };
  const set = async (patch: Record<string, boolean>) => { try { await s.hub.call('setSettings', patch); await s.refreshState(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3"><label htmlFor="notify-done" className="text-[13px]"><span className="font-medium">Notify when a turn finishes</span><span className="block text-xs text-muted-foreground">Off: system notifications only when an agent waits for you or fails. Everything still goes to the bell.</span></label><Switch id="notify-done" checked={settings.notifyDone === true} onCheckedChange={(v) => set({ notifyDone: v })} /></div>
      <div className="flex items-center justify-between gap-3"><label htmlFor="keep-awake" className="text-[13px]"><span className="font-medium">Keep the computer awake while agents run</span><span className="block text-xs text-muted-foreground">Closing a laptop lid can still put it to sleep.</span></label><Switch id="keep-awake" checked={settings.keepAwake !== false} onCheckedChange={(v) => set({ keepAwake: v })} /></div>
    </div>
  );
}
