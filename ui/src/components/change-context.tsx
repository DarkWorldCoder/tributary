import { MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/agent-avatar';
import { ago } from '@/lib/format';
import { useStore } from '@/store';

/** Report recorded activity; never infer authorship or invent a reason from a diff. */
export function ChangeContext({ rel, projectRel, diff }: { rel: string; projectRel: string | null; diff: string }) {
  const s = useStore();
  const messages = s.thread?.messages ?? [];
  const related = messages.flatMap((message, index) => {
    if (message.role !== 'assistant' || !message.files.some((file) => !file.external && file.rel === projectRel)) return [];
    const task = messages.slice(0, index).reverse().find((message) => message.role === 'user');
    return [{ message, task }];
  }).slice(-5).reverse();
  const showChat = () => {
    s.setWorkspaceExpanded(false);
    if (window.innerWidth < 768) s.setPanel({ ...s.panel, open: false });
  };
  return <div className="flex flex-wrap items-center gap-2">
    {related.length > 0 && <details className="min-w-0 flex-1 basis-full rounded-md border text-xs">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground">Related activity in this chat · {related.length}</summary>
      <ul className="space-y-2 border-t p-3">{related.map(({ message, task }) => <li key={message.id} className="flex items-start gap-2">
        <AgentAvatar agent={s.agentOf(message.agent)} size="xs" />
        <div className="min-w-0 flex-1"><p className="text-muted-foreground">{s.agentOf(message.agent).name}{message.ts ? ` · ${ago(message.ts)}` : ''}</p>{task && <p className="line-clamp-2 pt-1">{task.text}</p>}</div>
        <Button variant="ghost" size="icon-sm" aria-label={`View ${s.agentOf(message.agent).name} response`} title="View response" onClick={() => {
          showChat();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const item = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(message.id)}"]`);
            item?.scrollIntoView({ block: 'start' });
            if (item) { item.tabIndex = -1; item.focus({ preventScroll: true }); }
          }));
        }}><MessageSquare /></Button>
      </li>)}</ul>
    </details>}
    <Button variant="outline" size="sm" disabled={!diff} onClick={() => {
      const question = `Explain the changes in ${JSON.stringify(rel)}. Do not edit files.\n\nShow the affected files and functions, what changed, how the code works, and why the change fits the task. Distinguish recorded reasons from your own inference. Point out risks and checks I should make.\n\nCurrent working-tree patch${diff.length > 16000 ? ' (excerpt; read the full diff before concluding)' : ''}:\n${diff.slice(0, 16000)}`;
      s.setDraft((current) => current ? `${current}\n\n${question}` : question);
      s.setMode('read'); showChat();
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]')?.focus());
    }}><Sparkles />Explain change</Button>
  </div>;
}
