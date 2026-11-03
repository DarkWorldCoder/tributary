import { FileDiff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
export function ChatReviewBar() {
  const s = useStore();
  const files = new Set(s.thread?.messages.flatMap((m) => m.role === 'assistant' ? m.files.filter((f) => !f.external).map((f) => f.rel) : []) || []);
  if (!files.size) return null;
  return <div aria-label="Chat changes" className="mb-1 flex min-h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground"><FileDiff className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{files.size} {files.size === 1 ? 'file' : 'files'} touched</span><Button variant="ghost" size="xs" aria-label="Review chat changes" onClick={() => s.openPanel('changes')}>Review</Button></div>;
}
