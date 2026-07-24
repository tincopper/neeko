import React from 'react';
import { cn } from '@/lib/utils';

interface ConversationListSkeletonProps {
  /** Number of placeholder rows (default 6). */
  rows?: number;
  className?: string;
}

/**
 * Fishbone list placeholder — mirrors ConversationItem geometry so the shell
 * feels populated before hydrate/scan finishes.
 */
const ConversationListSkeleton: React.FC<ConversationListSkeletonProps> = React.memo(({
  rows = 6,
  className,
}) => {
  return (
    <div
      className={cn('flex flex-col py-1 px-1', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading conversations"
    >
      <div className="px-3 py-1">
        <div className="h-2.5 w-12 rounded bg-bg-hover animate-pulse" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 pl-3 pr-2 py-2 rounded-md border-l-2 border-l-transparent"
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-3.5 rounded bg-bg-hover animate-pulse',
                i % 3 === 0 ? 'w-[72%]' : i % 3 === 1 ? 'w-[58%]' : 'w-[65%]',
              )}
            />
            <div className="ml-auto h-3 w-10 rounded bg-bg-hover/80 animate-pulse shrink-0" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3.5 w-3.5 rounded bg-bg-hover animate-pulse shrink-0" />
            <div className="h-2.5 w-16 rounded bg-bg-hover/80 animate-pulse" />
            <div className="h-2.5 w-10 rounded bg-bg-hover/60 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
});
ConversationListSkeleton.displayName = 'ConversationListSkeleton';

export default ConversationListSkeleton;
