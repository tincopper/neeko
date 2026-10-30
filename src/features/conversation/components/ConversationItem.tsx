import { SquareTerminal, Eye, MessageSquare } from 'lucide-react';
import React, { useMemo } from 'react';

import { AgentIcon } from '@/features/agent';
import type { AgentConfig } from '@/features/agent/types';
import { cn } from '@/lib/utils';

import type { ConversationMeta } from '../types';
import { HighlightedText } from '../utils/HighlightedText';

interface ConversationItemProps {
  meta: ConversationMeta;
  agents: AgentConfig[];
  active?: boolean;
  /** Search query; matched title text is highlighted. */
  highlightQuery?: string;
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
  /**
   * 恢复为 Agent Chat（可选；由容器层按 chat 侧能力决定是否传）。
   *
   * 与 `onResume` 是**两个正交的轴**：这一条只需要「有原生会话 id + 该 agent 的
   * chat 适配器能重新绑定」，**不需要** CLI 能否 `--resume`（`meta.supportsResume`）。
   * 把两者串成一条会让「chat 能恢复但 CLI 不能恢复」的 agent 静默丢掉入口。
   */
  onChatResume?: (meta: ConversationMeta) => void;
  /**
   * 该 agent 能否把原生会话恢复为 Agent Chat（**唯一真相**：后端
   * `agent_chat_supports_resume`，由容器层算好下传）。
   *
   * 未提供 = 未知 = 不显入口（宁缺不错）：默认放行会让「删了查询」这类改动
   * 静默退回死入口，而这正是本入口要消灭的形态。
   */
  canChatResume?: (agentId: string) => boolean;
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

const ConversationItem: React.FC<ConversationItemProps> = React.memo(
  ({
    meta,
    agents,
    active = false,
    highlightQuery,
    onView,
    onResume,
    onChatResume,
    canChatResume,
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
          active ? 'border-l-accent-blue bg-bg-selected' : 'border-l-transparent hover:bg-bg-hover',
        )}
      >
        {/* Title + hover actions */}
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 text-[13px] text-text-primary font-medium truncate leading-tight">
            {highlightQuery ? (
              <HighlightedText text={meta.userTitle ?? meta.title} query={highlightQuery} />
            ) : (
              (meta.userTitle ?? meta.title)
            )}
          </span>
          <div
            className={cn(
              'flex items-center gap-0.5 shrink-0 transition-opacity',
              'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}
          >
            {/*
              两个入口各按自己的真相显隐，不互相嵌套：
              - Agent Chat：有原生会话 id + chat 适配器能重新绑定（chat 侧能力）；
              - Resume：CLI 能 `--resume`（conversation 侧 `supportsResume`）。
              串成一个 gate 会让两边都出现「能用却没入口」（R3.4：不做「悄悄消失」）。
            */}
            {onChatResume && meta.nativeSessionId && canChatResume?.(meta.agentId) === true ? (
              <button
                type="button"
                className="p-1 rounded-md text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onChatResume(meta);
                }}
                title="Open in Agent Chat"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            ) : null}
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
  },
);
ConversationItem.displayName = 'ConversationItem';

export default ConversationItem;
