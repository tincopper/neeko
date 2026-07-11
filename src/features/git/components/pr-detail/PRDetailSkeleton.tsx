import React, { useEffect } from 'react';
import { Badge } from '@/ui/badge';

interface PRDetailSkeletonProps {
  prTitle: string;
  prState: string;
  prAuthor: string;
  prCreatedAt: string;
  prBaseRef: string;
  prNumber: number;
  onReady?: () => void;
}

function getStateBadgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state.toUpperCase()) {
    case 'OPEN': return 'default';
    case 'CLOSED': return 'destructive';
    case 'MERGED': return 'secondary';
    default: return 'outline';
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

const FILE_ROWS = ['65%', '80%', '55%', '72%', '60%', '78%', '50%', '68%'];
const BODY_ROWS = ['100%', '85%', '70%', '95%', '60%'];
const COMMIT_ROWS = ['85%', '70%', '90%'];

const PRDetailSkeleton: React.FC<PRDetailSkeletonProps> = ({
  prTitle,
  prState,
  prAuthor,
  prCreatedAt,
  prBaseRef,
  prNumber,
  onReady,
}) => {
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
  <div className="flex-1 flex overflow-hidden">
    <div className="w-[35%] min-w-[250px] border-r border-border flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border bg-bg-secondary">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[var(--font-size)] font-semibold text-text-primary truncate flex-1 mr-2">
            {prTitle}
          </h3>
          <Badge variant={getStateBadgeVariant(prState)}>{prState.toUpperCase()}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted mb-2">
          <span>{prAuthor}</span>
          <span>·</span>
          <span>{formatTimestamp(prCreatedAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted">
          <span>Changes from</span>
          <span className="inline-block w-12 h-3 rounded bg-bg-tertiary animate-pulse align-middle" />
          <span>into</span>
          <span className="font-mono text-accent-blue">{prBaseRef}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-1.5">
        {FILE_ROWS.map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-bg-tertiary shrink-0" />
            <div className="h-2.5 rounded bg-bg-tertiary animate-pulse" style={{ width: w }} />
          </div>
        ))}
      </div>
    </div>

    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border bg-bg-secondary">
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          {prTitle} <span className="text-text-muted">#{prNumber}</span>
        </h2>
        <div className="flex items-center gap-2 text-[var(--font-size)] text-text-muted">
          <span>{prAuthor}</span>
          <span>·</span>
          <span>{formatTimestamp(prCreatedAt)}</span>
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
  </div>
  );
};

PRDetailSkeleton.displayName = 'PRDetailSkeleton';
export default React.memo(PRDetailSkeleton);
