import * as React from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FileTypeIcon } from '@/components/file-type-icon';
import { duration, toolTarget, toolVerb } from '@/lib/format';
import { thinkingExcerpt } from '@/lib/reply-segments.mjs';
import { toolFileReferences } from '@/lib/tool-file-references.mjs';
import { toolPreview } from '@/lib/tool-preview.mjs';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { AgentMessage, ReplyActivity, Tool } from '@/types';

export function ActivityTime({ ts }: { ts?: number }) {
  if (!ts || !Number.isFinite(ts)) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  return <time dateTime={date.toISOString()} title={date.toLocaleString()} className="ml-auto shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>;
}

function ToolCard({ tool, ts }: { tool: Tool; ts?: number }) {
  const s = useStore();
  const [expanded, setExpanded] = React.useState(false);
  const command = toolVerb(tool) === 'Ran';
  const target = toolTarget(tool, s.workdir);
  const description = typeof tool.input?.description === 'string' ? tool.input.description : tool.title && tool.title !== tool.name ? tool.title : command ? 'Run command' : target;
  const input = command ? target : '';
  const preview = React.useMemo(() => ({ input: toolPreview(input), output: toolPreview(tool.output) }), [input, tool.output]);
  const more = preview.input.truncated || preview.output.truncated;
  const shown = React.useMemo(() => expanded ? { input: toolPreview(input, { lines: 500, characters: 60000 }), output: toolPreview(tool.output, { lines: 500, characters: 60000 }) } : preview, [expanded, input, tool.output, preview]);
  const files = toolFileReferences(tool, s.workdir);
  return <section className="sidebar-timeline-item" data-status={tool.status} aria-label={`${tool.name}: ${description || tool.status}`}>
    <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] leading-5">
      <span className={cn('shrink-0 font-semibold', tool.status === 'error' && 'text-destructive')}>{tool.name}</span>
      {description && <span className="min-w-0 flex-1 break-words text-muted-foreground">{description}</span>}
      <ActivityTime ts={ts} />
    </div>
    {(input || tool.output) && <Collapsible open={expanded} onOpenChange={setExpanded} className="sidebar-tool-card overflow-hidden rounded-md border bg-background/30">
      {!expanded && <div aria-label="Tool preview">
        {preview.input.text && <ToolBlock label="IN" text={preview.input.text} truncated={preview.input.truncated} />}
        {preview.output.text && <ToolBlock label="OUT" text={preview.output.text} truncated={preview.output.truncated} />}
      </div>}
      <CollapsibleContent aria-label="Expanded tool preview">
        {shown.input.text && <ToolBlock label="IN" text={shown.input.text} truncated={shown.input.truncated} expanded />}
        {shown.output.text && <ToolBlock label="OUT" text={shown.output.text} truncated={shown.output.truncated} expanded />}
      </CollapsibleContent>
      {more && <div className="border-t px-2 py-0.5"><CollapsibleTrigger asChild><Button size="xs" variant="ghost" className="h-6 text-[11px] text-muted-foreground" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tool.name} output`}>{expanded ? 'Show less' : 'Show more'}<ChevronRight className={cn('size-3', expanded && 'rotate-90')} /></Button></CollapsibleTrigger></div>}
    </Collapsible>}
    {files.length > 0 && <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1">{files.map((file) => <button type="button" key={file.rel} aria-label={`Open ${file.rel} in code editor`} title={file.rel} onClick={() => s.editFile(file.rel, file.line, file.column)} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded text-left text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"><FileTypeIcon path={file.rel} /><span className="truncate">{file.rel}{file.line ? `:${file.line}` : ''}</span></button>)}</div>}
    {tool.status === 'running' && <span className="sr-only">{command ? 'Running command' : 'In progress'}</span>}
    {tool.status === 'error' && <p className="mt-1 text-xs text-destructive">Tool failed</p>}
  </section>;
}

function ToolBlock({ label, text, truncated, expanded = false }: { label: string; text: string; truncated: boolean; expanded?: boolean }) {
  return <div className={cn('flex min-w-0 gap-2 px-2 py-2', label === 'OUT' && 'border-t bg-muted/50')}>
    <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] leading-4 text-muted-foreground">{label}</span>
    <pre tabIndex={0} aria-label={label === 'IN' ? 'Tool input' : 'Tool output'} className={cn('min-w-0 flex-1 overflow-auto whitespace-pre rounded-sm font-mono text-[11px] leading-[1.6] [tab-size:2] focus-visible:outline-2 focus-visible:outline-ring', expanded ? 'max-h-96' : 'max-h-40')}><code>{text}</code>{truncated && <span className="block text-muted-foreground">…</span>}</pre>
  </div>;
}

export function SidebarActivity({ m, entries, live }: { m: AgentMessage; entries: ReplyActivity[]; live: boolean }) {
  return <div className="sidebar-activity flex min-w-0 flex-col gap-5" aria-label="Reply activity">{entries.map((entry, index) => {
    if (entry.kind === 'tool') return m.tools[entry.toolIndex] ? <ToolCard key={`tool:${entry.toolIndex}`} tool={m.tools[entry.toolIndex]} ts={entry.ts} /> : null;
    if (entry.kind === 'thinking') {
      const text = thinkingExcerpt(m, entry);
      const thinking = live && index === entries.length - 1 && entry.endedAt == null;
      const elapsed = entry.ts != null && entry.endedAt != null ? Math.max(0, entry.endedAt - entry.ts) : null;
      const label = thinking ? 'Thinking' : elapsed != null ? `Thought for ${elapsed < 1000 ? 'less than a second' : duration(elapsed)}` : 'Thought';
      return <div key={`thinking:${index}`} className="sidebar-timeline-item" data-status={thinking ? 'running' : 'thought'}><Collapsible>
        <CollapsibleTrigger disabled={!text} className="group flex min-w-0 items-center gap-2 rounded text-left text-xs leading-5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Brain className="size-3.5 shrink-0" />{label}{text && <ChevronRight className="size-3 group-data-[state=open]:rotate-90" />}</CollapsibleTrigger>
        <CollapsibleContent><p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{text}</p></CollapsibleContent>
      </Collapsible></div>;
    }
    return <div key={`plan:${index}`} className="sidebar-timeline-item" data-status="plan"><p className="mb-2 text-xs font-semibold">Plan</p><ul className="flex flex-col gap-2 text-[13px]" aria-label="Agent plan">{entry.items.map((item, i) => <li key={i} className={cn('flex items-start gap-2 leading-5', item.done && 'text-muted-foreground line-through')}><Checkbox checked={!!item.done} disabled aria-hidden tabIndex={-1} className="mt-0.5 disabled:cursor-default disabled:opacity-100" /><span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>{item.text}</li>)}</ul></div>;
  })}</div>;
}
