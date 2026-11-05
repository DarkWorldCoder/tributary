import { Fragment } from 'react';
import { searchLabelRanges } from '@/lib/search-label.mjs';

/** VS Code HighlightedLabel's range rendering, adapted to React text nodes. */
export function SearchLabel({ text, query, source = text, offset = 0 }: { text: string; query: string; source?: string; offset?: number }) {
  const ranges = searchLabelRanges(source, query);
  let position = 0;
  const parts = ranges.flatMap((range) => {
    const start = Math.max(0, range.start - offset), end = Math.min(text.length, range.end - offset);
    if (end <= start) return [];
    const before = text.slice(position, start); position = end;
    return [<Fragment key={start}>{before}<span className="search-label-match">{text.slice(start, end)}</span></Fragment>];
  });
  return <>{parts}{text.slice(position)}</>;
}
