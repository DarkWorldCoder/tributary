import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '@/components/ui/code-block';
import { useHighlightedCode } from '@/hooks/use-highlighted-code';
import { hub } from '@/store';

export function HighlightedCode({ code, language, title, wrap, lineNumbers, size = 'sm' }: { code: string; language: string; title?: React.ReactNode; wrap?: boolean; lineNumbers?: boolean; size?: 'sm' | 'default' }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock size={size}>
      {title ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title}</CodeBlockTitle>
          <CodeBlockActions><CodeBlockCopyButton value={code} /></CodeBlockActions>
        </CodeBlockHeader>
      ) : (
        <CodeBlockActions><CodeBlockCopyButton value={code} /></CodeBlockActions>
      )}
      <CodeBlockContent wrap={wrap} lineNumbers={lineNumbers} className="max-h-[28rem]">
        {lines.map((l, i) => <CodeBlockLine key={i}>{l}</CodeBlockLine>)}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const text = String(children ?? '');
    const lang = /language-([\w+-]+)/.exec(className || '')?.[1];
    if (!lang && !text.includes('\n')) return <code>{children}</code>;
    return <HighlightedCode code={text.replace(/\n$/, '')} language={lang || 'text'} title={lang && lang !== 'text' ? <span className="font-mono text-xs text-muted-foreground">{lang}</span> : undefined} />;
  },
  a({ href, children }) {
    return <a href={href} onClick={(e) => { e.preventDefault(); if (href && /^https?:/.test(href)) hub.call('openExternal', href); }}>{children}</a>;
  },
};

/** Agent replies as GitHub-flavored markdown. Raw HTML is never rendered. */
export const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  return <div className="prose-reply"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown></div>;
});
