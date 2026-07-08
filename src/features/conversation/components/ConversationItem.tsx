import React, { useMemo } from 'react';
import { Play, FileText } from 'lucide-react';
import AgentIcon from '@/features/agent/components/AgentIcon';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationItemProps {
  meta: ConversationMeta;
  agents: AgentConfig[];
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
}

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const ConversationItem: React.FC<ConversationItemProps> = React.memo(({
  meta,
  agents,
  onView,
  onResume,
}) => {
  const agent = useMemo(
    () => agents.find((a) => a.id === meta.agentId) ?? null,
    [agents, meta.agentId],
  );

  const timeStr = useMemo(() => formatRelativeTime(meta.startedAt), [meta.startedAt]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md bg-bg-secondary/50 border border-border hover:bg-bg-hover transition-colors">
      {/* Header: Agent icon + name + time */}
      <div className="flex items-center gap-2">
        <div className="shrink-0 w-5 h-5 flex items-center justify-center">
          <AgentIcon icon={agent?.icon ?? null} size={16} />
        </div>
        <span className="text-xs text-text-secondary font-medium truncate">
          {agent?.name ?? meta.agentId}
        </span>
        <span className="ml-auto text-[11px] text-text-secondary/60 shrink-0">
          {timeStr}
        </span>
      </div>

      {/* Title + message count */}
      <div className="flex items-center gap-2">
        <span className="text-[var(--font-size)] text-text-primary font-medium truncate">
          {meta.title}
        </span>
        {meta.messageCount > 0 && (
          <span className="text-[11px] text-text-secondary/60 shrink-0">
            {meta.messageCount} msgs
          </span>
        )}
      </div>

      {/* Preview */}
      {meta.preview && (
        <p className="text-xs text-text-secondary/70 line-clamp-2 leading-relaxed">
          {meta.preview}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 px-2 text-xs gap-1',
            'text-accent-green hover:text-accent-green hover:bg-accent-green/10',
          )}
          onClick={() => onResume(meta)}
        >
          <Play className="w-3 h-3" />
          Resume
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => onView(meta)}
        >
          <FileText className="w-3 h-3" />
          View
        </Button>
      </div>
    </div>
  );
});
ConversationItem.displayName = 'ConversationItem';

export default ConversationItem;
