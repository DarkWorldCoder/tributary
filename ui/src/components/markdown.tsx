import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '@/components/ui/code-block';
import { useHighlightedCode } from '@/hooks/use-highlighted-code';
import { splitBlocks } from '@/lib/markdown-blocks.mjs';
import { hub } from '@/store';
import { MarkdownImage } from '@/components/markdown-image';

const PreviewFile = React.createContext<{ file?: string; project?: string }>({});
function ImageElement({ src, alt }: { src?: string | Blob; alt?: string }) {
  const baseFile = React.useContext(PreviewFile);
  return <MarkdownImage source={typeof src === 'string' ? src : ''} alt={alt} baseFile={baseFile.file} project={baseFile.project} />;
}

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
  img: ImageElement,
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

const plugins = [remarkGfm];
const Block = React.memo(function Block({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown>;
});

/** Agent replies as GitHub-flavored markdown. Raw HTML is never rendered. A long reply is parsed block by block,
 * so while it streams only the block being written is parsed again (a 9 KB reply: 28 ms per update down to about 1 ms). */
export const Markdown = React.memo(function Markdown({ text, baseFile, project }: { text: string; baseFile?: string; project?: string }) {
  const blocks = React.useMemo(() => splitBlocks(text), [text]);
  return <PreviewFile.Provider value={React.useMemo(() => ({ file: baseFile, project }), [baseFile, project])}><div className="prose-reply">{blocks.map((b, i) => <Block key={i} text={b} />)}</div></PreviewFile.Provider>;
});
