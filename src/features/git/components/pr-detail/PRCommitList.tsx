import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { PRCommit } from '../../types';

interface PRCommitListProps {
  commits: PRCommit[];
  onCommitClick?: (hash: string) => void;
  loading?: boolean;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

const PRCommitList: React.FC<PRCommitListProps> = ({ commits, onCommitClick, loading }) => {
  const handleCommitClick = useCallback(
    (hash: string) => {
      onCommitClick?.(hash);
    },
    [onCommitClick]
  );

  if (loading) {
    return (
      <div className="px-4 space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-12 h-3 rounded bg-bg-tertiary animate-pulse shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div className="w-full h-3 rounded bg-bg-tertiary animate-pulse" />
              <div className="w-2/3 h-2.5 rounded bg-bg-tertiary animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        No commits
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {commits.map((commit) => (
        <div
          key={commit.hash}
          className="flex items-start gap-3 py-2 px-4 hover:bg-bg-hover transition-colors duration-100"
        >
          <button
            className={cn(
              "font-mono text-[calc(var(--font-size)-2px)] px-1.5 py-0.5 rounded shrink-0",
              "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors duration-100",
              "cursor-pointer border-none"
            )}
            onClick={() => handleCommitClick(commit.hash)}
            title={`View commit ${commit.hash}`}
          >
            {commit.shortHash}
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size)] text-text-primary truncate">
              {commit.message}
            </div>
            <div className="text-[calc(var(--font-size)-2px)] text-text-muted mt-0.5">
              {commit.author} · {formatTimestamp(commit.timestamp)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default React.memo(PRCommitList);
