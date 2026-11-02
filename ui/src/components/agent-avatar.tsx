import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

const SIZES = { xs: 'size-[18px] text-[9px]', sm: 'size-5 text-[10px]', md: 'size-7 text-[11.5px]', lg: 'size-9 text-[13px]' } as const;

/** Agent identity mark: the agent's own color with a two-letter glyph. Decorative; the name is always shown next to it. */
export function AgentAvatar({ agent, size = 'sm', className, muted }: { agent: Agent; size?: keyof typeof SIZES; className?: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-tight text-white select-none', SIZES[size], muted && 'opacity-45 grayscale', className)}
      style={{ background: agent.color }}
    >
      {agent.glyph ?? agent.name.slice(0, 2)}
    </span>
  );
}
