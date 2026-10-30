import { ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import { AgentIcon } from '@/features/agent';
import type { AgentConfig } from '@/features/agent/types';
import { cn } from '@/lib/utils';
import { useScrollMemory } from '@/shared/hooks/useScrollMemory';
import { buildScrollKey } from '@/shared/utils/scrollMemory';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { Button } from '@/ui/Button';

import { useConversationDeleteAction } from '../hooks/useConversationDeleteAction';
import { useConversationList } from '../hooks/useConversationList';
import { useConversationResume } from '../hooks/useConversationResume';
import { useFilterRowOverflow } from '../hooks/useFilterRowOverflow';
import type { ConversationMeta } from '../types';
import { buildAgentOptions, countByAgent, filterConversations } from '../utils/conversationFilters';

import ConversationList from './ConversationList';

/** 滚动视图身份：全局唯一 surface 常量（owner 段按项目隔离）。 */
const SCROLL_SURFACE = 'dock.conversations';

interface ConversationPanelProps {
  projectPath: string | null;
  projectId: ProjectId | null;
  agents: AgentConfig[];
  isActive: boolean;
  showToast: (message: string, type?: 'info' | 'error') => void;
  onOpenConversationTab: (meta: ConversationMeta) => void;
  onResumeConversation: (meta: ConversationMeta) => Promise<void>;
  /** 恢复为 Agent Chat（可选；未传时入口隐藏）。 */
  onChatResumeConversation?: (meta: ConversationMeta) => void;
  /** 该 agent 能否恢复为 Agent Chat（唯一真相，由 wrapper 下传）。 */
  canChatResume?: (agentId: string) => boolean;
  /** 删除会话（容器层编排；返回 `true` = 磁盘已删。未传 = 无删除入口）。 */
  onDeleteConversation?: (meta: ConversationMeta) => Promise<boolean>;
}

const ConversationPanel: React.FC<ConversationPanelProps> = React.memo(
  ({
    projectPath,
    projectId,
    agents,
    isActive,
    showToast,
    onOpenConversationTab,
    onResumeConversation,
    onChatResumeConversation,
    canChatResume,
    onDeleteConversation,
  }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [agentFilter, setAgentFilter] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [filterExpanded, setFilterExpanded] = useState(false);
    const filterRowRef = useRef<HTMLDivElement | null>(null);
    const {
      conversations,
      total,
      hasMore,
      loadingMore,
      loading,
      refreshing,
      forceRefresh,
      loadMore,
      removeConversation,
    } = useConversationList(projectPath, isActive, agentFilter ?? undefined);
    const { isResuming } = useConversationResume(projectId);

    // 滚动记忆：面板互切（保活期引擎丢位置）与卸载重建都恢复列表位置；按项目隔离。
    const scrollRef = useScrollMemory<HTMLDivElement>(buildScrollKey(SCROLL_SURFACE, projectId));

    // 「All」计数与 chip 目录保留上次未筛选页的值（口径见 utils/conversationFilters）。
    const projectTotalRef = useRef(0);
    if (!agentFilter && total > 0) projectTotalRef.current = total;
    else if (!agentFilter && conversations.length === 0 && !loading && !refreshing)
      projectTotalRef.current = 0;
    const allChipCount = agentFilter
      ? projectTotalRef.current || conversations.length
      : total || conversations.length;

    const agentCatalogRef = useRef<Map<string, number>>(new Map());
    if (!agentFilter) {
      const next = countByAgent(conversations);
      // Prefer non-empty catalog; avoid wiping chips during empty skeleton/hydrate.
      if (next.size > 0 || agentCatalogRef.current.size === 0) agentCatalogRef.current = next;
    }
    const agentOptions = useMemo(
      () => buildAgentOptions({ catalog: agentCatalogRef.current, agents, agentFilter, total }),
      [agents, agentFilter, total],
    );
    const filteredConversations = useMemo(
      () => filterConversations(conversations, searchQuery),
      [conversations, searchQuery],
    );
    const hasClientSearch = Boolean(searchQuery.trim());
    const hasActiveFilters = Boolean(hasClientSearch || agentFilter);

    const handleRefresh = useCallback(() => {
      void forceRefresh();
    }, [forceRefresh]);

    const handleView = useCallback(
      (meta: ConversationMeta) => {
        setActiveId(meta.id);
        onOpenConversationTab(meta);
      },
      [onOpenConversationTab],
    );

    /**
     * 删除动作装配（成功才清选中 + 移除行；编排抛错必须可见）。
     * 细节与判据见 `useConversationDeleteAction`。
     */
    const handleDelete = useConversationDeleteAction({
      requestDelete: onDeleteConversation,
      removeConversation,
      showToast,
      onDeleted: (id) => setActiveId((prev) => (prev === id ? null : prev)),
    });

    const handleResume = useCallback(
      async (meta: ConversationMeta) => {
        if (isResuming) return;
        try {
          showToast(`Starting ${meta.agentId}...`, 'info');
          await onResumeConversation(meta);
          showToast('Resuming conversation...', 'info');
          // 延迟刷新，等 Agent 更新完 session 文件
          setTimeout(() => {
            void forceRefresh();
          }, 2000);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to resume conversation';
          showToast(msg, 'error');
        }
      },
      [isResuming, showToast, onResumeConversation, forceRefresh],
    );

    // 折叠态筛选行是否溢出单行（测量逻辑见 useFilterRowOverflow）。
    const filterOverflow = useFilterRowOverflow(filterRowRef, agentOptions.length, filterExpanded);

    if (!projectPath) {
      return (
        <div className="flex flex-col h-full">
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-medium text-text-primary">History</span>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xs text-text-secondary/60">No project selected</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium text-text-primary">History</span>
            {conversations.length > 0 ? (
              <span className="text-[11px] text-text-muted tabular-nums">
                {conversations.length}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh conversations"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing ? 'animate-spin' : '')} />
          </Button>
        </div>

        {/* Search + filters toolbar */}
        <div className="shrink-0 flex flex-col gap-1.5 px-2 py-2 border-b border-border">
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              role="searchbox"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault();
                  setSearchQuery('');
                }
              }}
              placeholder="Search conversations…"
              className={cn(
                'w-full h-7 pl-7 text-[12px] rounded-md',
                'bg-bg-hover/50 border border-border/80',
                'text-text-primary placeholder:text-text-muted',
                'outline-none focus:border-accent-blue/60 focus:bg-bg-primary transition-colors',
                searchQuery ? 'pr-7' : 'pr-2.5',
              )}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 p-0.5 text-text-muted hover:text-text-primary rounded"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Agent type filter — collapses to one line, expandable when it overflows */}
          {agentOptions.length > 1 ? (
            <div className="flex items-start gap-1">
              <div
                ref={filterRowRef}
                className={cn(
                  'flex flex-wrap items-center gap-1 min-w-0 flex-1',
                  filterExpanded ? '' : 'max-h-6 overflow-hidden',
                )}
                role="group"
                aria-label="Filter by agent"
              >
                <button
                  type="button"
                  onClick={() => setAgentFilter(null)}
                  aria-pressed={agentFilter === null}
                  className={cn(
                    'shrink-0 h-6 px-2 text-[11px] rounded-md transition-colors',
                    agentFilter === null
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover',
                  )}
                >
                  All
                  <span className="ml-1 text-text-muted tabular-nums">{allChipCount}</span>
                </button>
                {agentOptions.map(({ id, count, agent }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAgentFilter(agentFilter === id ? null : id)}
                    aria-pressed={agentFilter === id}
                    title={agent?.name ?? id}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors max-w-[140px]',
                      agentFilter === id
                        ? 'bg-bg-selected text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    {agent ? (
                      <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                        <AgentIcon icon={agent.icon} size={12} />
                      </span>
                    ) : null}
                    <span className="truncate">{agent?.name ?? id}</span>
                    <span className="text-text-muted tabular-nums shrink-0">{count}</span>
                  </button>
                ))}
              </div>
              {filterOverflow || filterExpanded ? (
                <button
                  type="button"
                  onClick={() => setFilterExpanded((v) => !v)}
                  aria-expanded={filterExpanded}
                  title={filterExpanded ? 'Collapse filters' : 'Show all filters'}
                  className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      filterExpanded ? 'rotate-180' : '',
                    )}
                  />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Result count while filtering */}
          {hasActiveFilters ? (
            <p className="text-[10px] text-text-muted tabular-nums px-0.5">
              {filteredConversations.length} of {Math.max(total, conversations.length)}
            </p>
          ) : null}
        </div>

        {/* List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!(loading && conversations.length === 0) &&
          hasClientSearch &&
          filteredConversations.length === 0 &&
          conversations.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 px-4">
              <p className="text-xs text-text-secondary/60">No matching conversations</p>
              <button
                type="button"
                className="text-[11px] text-accent-blue hover:underline"
                onClick={() => {
                  setSearchQuery('');
                  setAgentFilter(null);
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ConversationList
              conversations={filteredConversations}
              agents={agents}
              loading={loading}
              refreshing={refreshing}
              hasMore={hasMore && !hasClientSearch}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              activeId={activeId}
              highlightQuery={searchQuery}
              onView={handleView}
              onResume={handleResume}
              onChatResume={onChatResumeConversation}
              canChatResume={canChatResume}
              onDelete={onDeleteConversation ? handleDelete : undefined}
            />
          )}
        </div>
      </div>
    );
  },
);
ConversationPanel.displayName = 'ConversationPanel';

export default ConversationPanel;
