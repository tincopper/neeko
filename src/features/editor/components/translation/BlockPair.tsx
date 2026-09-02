import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import type { SourceBlock } from '../../translation/blocks';

/** 单块行内 markdown 渲染（无块级包裹） */
const Inline: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ children }) => <>{children}</>,
      a: ({ children, href }) => (
        <span className="text-accent-blue" title={href}>
          {children}
        </span>
      ),
    }}
  >
    {text}
  </ReactMarkdown>
);

/** 单个双语块：原文在上（次级色），译文在下（主色 + 蓝色竖线） */
const BlockPair: React.FC<{
  block: SourceBlock;
  translation?: string;
  failed: boolean;
  running: boolean;
  bilingual: boolean;
  isPlain: boolean;
  onRetry: () => void;
}> = React.memo(({ block: b, translation, failed, running, bilingual, isPlain, onRetry }) => {
  const content = isPlain ? (
    <span className="whitespace-pre-wrap">{b.text}</span>
  ) : (
    <Inline text={b.text} />
  );

  return (
    <div className="pair">
      {bilingual && (
        <div className={cn('src text-text-secondary', b.kind === 'heading' && 'font-bold')}>
          {content}
        </div>
      )}
      {failed ? (
        <div className="dst flex items-center gap-2 border-l-2 border-accent-red/60 pl-3">
          <span className="text-text-muted text-xs">翻译失败</span>
          <button
            className="text-xs text-accent-blue hover:underline"
            onClick={onRetry}
            aria-label={`Retry ${b.id}`}
          >
            重试
          </button>
        </div>
      ) : translation !== undefined ? (
        <div
          className={cn(
            'dst border-l-2 border-accent-blue/45 pl-3 text-text-primary',
            b.kind === 'heading' && 'font-bold',
          )}
        >
          {isPlain ? (
            <span className="whitespace-pre-wrap">{translation}</span>
          ) : (
            <Inline text={translation} />
          )}
        </div>
      ) : running ? (
        <div className="flex items-center gap-2 border-l-2 border-accent-blue pl-3">
          <div className="flex-1 h-2.5 rounded bg-bg-hover animate-pulse" />
        </div>
      ) : null}
    </div>
  );
});

BlockPair.displayName = 'BlockPair';

export default React.memo(BlockPair);
