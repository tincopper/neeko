import React from 'react';

type DiffLineType = 'header' | 'hunk' | 'added' | 'removed' | 'context' | 'nonewline';

interface DiffLine {
  type: DiffLineType;
  content: string;
}

const LINE_STYLES: Record<DiffLineType, string> = {
  header: 'text-text-secondary/50',
  hunk: 'text-accent-blue bg-accent-blue/5',
  added: 'bg-diff-added text-diff-added-text',
  removed: 'bg-diff-removed text-diff-removed-text',
  context: '',
  nonewline: 'bg-bg-tertiary text-text-secondary/50',
};

interface InlineDiffBlockProps {
  code: string;
}

function InlineDiffBlockImpl({ code }: InlineDiffBlockProps) {
  const lines: DiffLine[] = [];
  for (const line of code.split('\n')) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('rename ') ||
      line.startsWith('similarity index')
    ) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.push({ type: 'added', content: line.slice(1) });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lines.push({ type: 'removed', content: line.slice(1) });
    } else if (line === '\\ No newline at end of file') {
      lines.push({ type: 'nonewline', content: line });
    } else {
      lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }

  if (lines.length === 0) return null;

  return (
    <div className="my-4 border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <pre className="text-xs leading-relaxed m-0 p-0">
          {lines.map((l, i) => (
            <div
              key={i}
              className={`px-3 leading-relaxed whitespace-pre font-mono ${
                l.type === 'header'
                  ? 'py-0.5 text-[11px]'
                  : l.type === 'nonewline'
                    ? 'py-0 text-[11px]'
                    : 'py-px text-xs'
              } ${LINE_STYLES[l.type]}`}
            >
              {l.type === 'header' || l.type === 'hunk' || l.type === 'nonewline'
                ? l.content
                : `${l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '} ${l.content}`}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export const InlineDiffBlock = React.memo(InlineDiffBlockImpl);
