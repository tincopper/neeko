import React, { useState } from 'react';

import { cn } from '@/lib/utils';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import DiffTable from '../diff/DiffTable';
import SplitDiffTable from '../diff/SplitDiffTable';
import type { ViewMode } from '../diff/types';
import { useDiffData } from '../diff/useDiffData';

interface InlineDiffPreviewProps {
  projectId: string;
  filePath: string | null;
}

const InlineDiffPreview: React.FC<InlineDiffPreviewProps> = ({ projectId, filePath }) => {
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--font-size)] text-text-muted">
        Select a file to preview
      </div>
    );
  }

  return <DiffContent projectId={projectId} filePath={filePath} />;
};

interface DiffContentProps {
  projectId: string;
  filePath: string;
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const DiffContent: React.FC<DiffContentProps> = ({ projectId, filePath }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const { diffResult, loading, error, changeStats } = useDiffData({ projectId, filePath });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--font-size)] text-text-muted">
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--font-size)] text-text-muted">
        Failed to load diff
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between py-1.5 px-3 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={fileIconSrc(getFileName(filePath))}
            alt=""
            width={14}
            height={14}
            className="shrink-0"
          />
          <span className="font-medium text-[var(--font-size)] truncate">
            {getFileName(filePath)}
          </span>
          <span className="text-text-muted text-[calc(var(--font-size)-2px)] truncate">
            {filePath}
          </span>
          {(changeStats.additions > 0 || changeStats.deletions > 0) && (
            <span className="text-[calc(var(--font-size)-2px)] text-text-muted whitespace-nowrap">
              <span className="text-accent-green">+{changeStats.additions}</span>{' '}
              <span className="text-accent-red">-{changeStats.deletions}</span>
            </span>
          )}
        </div>

        <div className="flex border border-border rounded overflow-hidden shrink-0">
          <button
            className={cn(
              'bg-transparent border-none text-text-secondary px-2 py-0.5 cursor-pointer text-[calc(var(--font-size)-1px)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border last:border-r-0',
              viewMode === 'unified' && '!bg-accent-blue !text-white',
            )}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
          <button
            className={cn(
              'bg-transparent border-none text-text-secondary px-2 py-0.5 cursor-pointer text-[calc(var(--font-size)-1px)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary',
              viewMode === 'split' && '!bg-accent-blue !text-white',
            )}
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {diffResult && diffResult.hunks.length > 0 ? (
          viewMode === 'unified' ? (
            <DiffTable
              diffResult={diffResult}
              language=""
              selectedLines={new Set()}
              onToggleLine={() => {}}
            />
          ) : (
            <SplitDiffTable
              diffResult={diffResult}
              language=""
              selectedLines={new Set()}
              onToggleLine={() => {}}
            />
          )
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--font-size)] text-text-muted">
            No changes to display
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(InlineDiffPreview);
