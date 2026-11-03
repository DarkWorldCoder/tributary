import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

const SIZES = { xs: 'size-[18px] text-[9px]', sm: 'size-5 text-[10px]', md: 'size-7 text-[11.5px]', lg: 'size-9 text-[13px]' } as const;

function glyphColor(background: string) {
  const hex = background.replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(hex)) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}

/** Agent identity mark: the agent's own color with a two-letter glyph. Decorative; the name is always shown next to it. */
export function AgentAvatar({ agent, size = 'sm', className, muted }: { agent: Agent; size?: keyof typeof SIZES; className?: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold select-none', SIZES[size], className)}
      style={{ background: muted ? 'var(--muted)' : agent.color, color: muted ? 'var(--muted-foreground)' : glyphColor(agent.color) }}
    >
      {agent.glyph ?? agent.name.slice(0, 2)}
    </span>
  );
}
