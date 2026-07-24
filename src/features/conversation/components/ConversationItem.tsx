import React, { useMemo } from 'react';
import { SquareTerminal, Eye } from 'lucide-react';
import AgentIcon from '@/features/agent/components/AgentIcon';
import { cn } from '@/lib/utils';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationItemProps {
  meta: ConversationMeta;
  agents: AgentConfig[];
  active?: boolean;
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
  active = false,
  onView,
  onResume,
}) => {
  const agent = useMemo(
    () => agents.find((a) => a.id === meta.agentId) ?? null,
    [agents, meta.agentId],
  );

  const timeStr = useMemo(() => formatRelativeTime(meta.updatedAt), [meta.updatedAt]);
  const fullTime = useMemo(() => new Date(meta.updatedAt).toLocaleString(), [meta.updatedAt]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView(meta)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView(meta);
        }
      }}
      className={cn(
        'group relative flex flex-col gap-1 pl-3 pr-2 py-2 rounded-md cursor-pointer',
        'border-l-2 transition-colors',
        active
          ? 'border-l-accent-blue bg-bg-hover/50'
          : 'border-l-transparent hover:bg-bg-hover/40',
      )}
    >
      {/* Title + hover actions */}
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-[13px] text-text-primary font-medium truncate leading-tight">
          {meta.userTitle ?? meta.title}
        </span>
        <div
          className={cn(
            'flex items-center gap-0.5 shrink-0 transition-opacity',
            'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          {meta.supportsResume === true ? (
            <button
              type="button"
              className="p-1 rounded-md text-text-muted hover:text-accent-green hover:bg-accent-green/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onResume(meta);
              }}
              title="Resume"
            >
              <SquareTerminal className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onView(meta);
            }}
            title="View"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Meta row: agent · msgs ······ time */}
      <div className="flex items-center gap-1.5 text-[11px] text-text-secondary min-w-0">
        {agent ? (
          <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
            <AgentIcon icon={agent.icon} size={12} />
          </span>
        ) : null}
        <span className="truncate">{agent?.name ?? meta.agentId}</span>
        {meta.messageCount > 0 ? (
          <>
            <span className="text-text-muted shrink-0">·</span>
            <span className="text-text-muted shrink-0">{meta.messageCount} msgs</span>
          </>
        ) : null}
        <span className="ml-auto shrink-0 text-text-muted" title={fullTime}>
          {timeStr}
        </span>
      </div>
    </div>
  );
});
ConversationItem.displayName = 'ConversationItem';

export default ConversationItem;
