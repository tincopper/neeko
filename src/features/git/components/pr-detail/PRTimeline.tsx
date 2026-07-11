import React from 'react';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  id: string;
  type: 'merge' | 'commit' | 'review' | 'label' | 'branch_delete';
  author: string;
  timestamp: string;
  message: string;
  branchName?: string;
  commitHash?: string;
}

interface PRTimelineProps {
  events: TimelineEvent[];
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

function getEventIcon(type: TimelineEvent['type']): { icon: string; color: string } {
  switch (type) {
    case 'merge':
      return { icon: '⎘', color: 'bg-accent-purple/20 text-accent-purple' };
    case 'commit':
      return { icon: '●', color: 'bg-accent-blue/20 text-accent-blue' };
    case 'review':
      return { icon: '✓', color: 'bg-accent-green/20 text-accent-green' };
    case 'label':
      return { icon: '🏷', color: 'bg-accent-yellow/20 text-accent-yellow' };
    case 'branch_delete':
      return { icon: '⊘', color: 'bg-accent-red/20 text-accent-red' };
    default:
      return { icon: '○', color: 'bg-text-muted/20 text-text-muted' };
  }
}

const PRTimeline: React.FC<PRTimelineProps> = ({ events, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        Loading timeline...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        No timeline events
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {events.map((event) => {
        const { icon, color } = getEventIcon(event.type);
        return (
          <div
            key={event.id}
            className="flex items-start gap-3 py-2 px-4 hover:bg-bg-hover transition-colors duration-100"
          >
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[0.7rem]",
              color
            )}>
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[var(--font-size)] text-text-primary">
                <span className="font-semibold">{event.author}</span>
                {' '}{event.message}
                {event.commitHash && (
                  <code className="font-mono text-accent-blue bg-accent-blue/10 px-1 py-0.5 rounded text-[calc(var(--font-size)-1px)] mx-1">
                    {event.commitHash.substring(0, 7)}
                  </code>
                )}
                {event.branchName && (
                  <>
                    {' into '}
                    <span className="font-mono text-accent-blue bg-accent-blue/10 px-1 py-0.5 rounded text-[calc(var(--font-size)-1px)]">
                      {event.branchName}
                    </span>
                  </>
                )}
              </div>
              <div className="text-[calc(var(--font-size)-2px)] text-text-muted mt-0.5">
                {formatTimestamp(event.timestamp)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(PRTimeline);
