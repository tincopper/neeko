import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';

interface PRDetailSkeletonProps {
  prTitle: string;
  prState: string;
  prAuthor: string;
  prCreatedAt: string;
  prNumber: number;
  onReady?: () => void;
}

function getStateBadgeClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'OPEN':
      return 'bg-accent-green/15 text-accent-green';
    case 'CLOSED':
      return 'bg-accent-red/15 text-accent-red';
    case 'MERGED':
      return 'bg-[#a371f7]/20 text-[#a371f7]';
    default:
      return 'bg-bg-tertiary text-text-muted';
  }
}

function formatTimestamp(timestamp: string | undefined | null): string {
  if (!timestamp) return 'Unknown';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp || 'Unknown';
  }
}

const BODY_ROWS = ['100%', '85%', '70%', '95%', '60%'];
const COMMIT_ROWS = ['85%', '70%', '90%'];

const PRDetailSkeleton: React.FC<PRDetailSkeletonProps> = ({
  prTitle,
  prState,
  prAuthor,
  prCreatedAt,
  prNumber,
  onReady,
}) => {
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[var(--font-size)] font-semibold text-text-primary truncate">{prTitle}</h2>
          <span className="text-text-muted text-[calc(var(--font-size)-2px)] shrink-0">#{prNumber}</span>
          <span className={cn('shrink-0 px-1.5 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide', getStateBadgeClass(prState))}>{prState.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted shrink-0">
          <div className="w-5 h-5 rounded-full bg-bg-tertiary animate-pulse shrink-0" />
          <span>{prAuthor}</span>
          <span>·</span>
          <span>{formatTimestamp(prCreatedAt)}</span>
        </div>
      </div>

      <div className="px-4 pt-0 border-b border-border bg-bg-secondary">
        <div className="flex h-[36px] items-end gap-5">
          <div className="h-[22px] w-24 rounded bg-bg-tertiary animate-pulse" />
          <div className="h-[22px] w-20 rounded bg-bg-tertiary animate-pulse" />
          <div className="h-[22px] w-28 rounded bg-bg-tertiary animate-pulse" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-2">
          {BODY_ROWS.map((w, i) => (
            <div key={i} className="h-3 rounded bg-bg-tertiary animate-pulse" style={{ width: w }} />
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border">
          <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">
            Commits <span className="inline-block w-5 h-3 rounded bg-bg-tertiary animate-pulse align-middle ml-1" />
          </h4>
          <div className="space-y-2.5">
            {COMMIT_ROWS.map((w, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-10 h-3 rounded bg-bg-tertiary animate-pulse shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded bg-bg-tertiary animate-pulse" style={{ width: w }} />
                  <div className="w-2/3 h-2.5 rounded bg-bg-tertiary animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

PRDetailSkeleton.displayName = 'PRDetailSkeleton';
export default React.memo(PRDetailSkeleton);
