import React from 'react';

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
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-start gap-3 py-2 px-4 hover:bg-bg-hover transition-colors duration-100"
        >
          {/* User Avatar */}
          <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 bg-bg-tertiary flex items-center justify-center text-[10px] font-medium text-text-muted">
            <img
              src={`https://avatars.githubusercontent.com/${event.author}?s=24`}
              alt={event.author}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).parentElement!.innerText = (event.author?.charAt(0) || '#').toUpperCase();
              }}
            />
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
      ))}
    </div>
  );
};

export default React.memo(PRTimeline);
