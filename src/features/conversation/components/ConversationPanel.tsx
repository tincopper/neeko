import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import AgentIcon from '@/features/agent/components/AgentIcon';
import { useConversationList } from '../hooks/useConversationList';
import { useConversationResume } from '../hooks/useConversationResume';
import ConversationList from './ConversationList';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationPanelProps {
  projectPath: string | null;
  projectId: string | null;
  agents: AgentConfig[];
  isActive: boolean;
  showToast: (message: string, type?: 'info' | 'error') => void;
  onOpenConversationTab: (meta: ConversationMeta) => void;
  onResumeConversation: (meta: ConversationMeta) => Promise<void>;
}

function matchesSearch(meta: ConversationMeta, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = (meta.userTitle ?? meta.title ?? '').toLowerCase();
  const preview = (meta.preview ?? '').toLowerCase();
  const agentId = (meta.agentId ?? '').toLowerCase();
  return title.includes(q) || preview.includes(q) || agentId.includes(q);
}

const ConversationPanel: React.FC<ConversationPanelProps> = React.memo(({
  projectPath,
  projectId,
  agents,
  isActive,
  showToast,
  onOpenConversationTab,
  onResumeConversation,
}) => {
  const { conversations, loading, refresh } = useConversationList(projectPath, isActive);
  const { isResuming } = useConversationResume(projectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [filterOverflow, setFilterOverflow] = useState(false);
  const filterRowRef = useRef<HTMLDivElement | null>(null);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleView = useCallback((meta: ConversationMeta) => {
    setActiveId(meta.id);
    onOpenConversationTab(meta);
  }, [onOpenConversationTab]);

  const handleResume = useCallback(async (meta: ConversationMeta) => {
    if (isResuming) return;
    try {
      showToast(`Starting ${meta.agentId}...`, 'info');
      await onResumeConversation(meta);
      showToast('Resuming conversation...', 'info');
      // 延迟刷新，等 Agent 更新完 session 文件
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resume conversation';
      showToast(msg, 'error');
    }
  }, [isResuming, showToast, onResumeConversation, refresh]);

  // Agents that appear in the current project conversation list (stable order by name)
  const agentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conversations) {
      counts.set(c.agentId, (counts.get(c.agentId) ?? 0) + 1);
    }
    const ids = [...counts.keys()];
    ids.sort((a, b) => {
      const nameA = agents.find((x) => x.id === a)?.name ?? a;
      const nameB = agents.find((x) => x.id === b)?.name ?? b;
      return nameA.localeCompare(nameB);
    });
    return ids.map((id) => ({
      id,
      count: counts.get(id) ?? 0,
      agent: agents.find((a) => a.id === id) ?? null,
    }));
  }, [conversations, agents]);

  // Drop stale filter if that agent no longer appears after refresh
  useEffect(() => {
    if (agentFilter && !agentOptions.some((o) => o.id === agentFilter)) {
      setAgentFilter(null);
    }
  }, [agentFilter, agentOptions]);

  // Detect whether the collapsed filter row overflows a single line.
  // Measure against the collapsed (single-line) height, so re-measure when
  // options change or the row width changes.
  useLayoutEffect(() => {
    const el = filterRowRef.current;
    if (!el || agentOptions.length <= 1) {
      setFilterOverflow(false);
      return;
    }
    const measure = () => {
      // scrollHeight exceeds one line's height => chips wrapped to >1 row
      setFilterOverflow(el.scrollHeight - el.clientHeight > 1);
    };
    if (!filterExpanded) measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!filterExpanded) measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [agentOptions, filterExpanded]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim();
    return conversations.filter((meta) => {
      if (agentFilter && meta.agentId !== agentFilter) return false;
      return matchesSearch(meta, q);
    });
  }, [conversations, agentFilter, searchQuery]);

  const hasActiveFilters = Boolean(searchQuery.trim() || agentFilter);

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
          disabled={loading}
          title="Refresh conversations"
        >
          <RefreshCw className={cn('w-4 h-4', loading ? 'animate-spin' : '')} />
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
                <span className="ml-1 text-text-muted tabular-nums">{conversations.length}</span>
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
                  className={cn('h-3.5 w-3.5 transition-transform', filterExpanded ? 'rotate-180' : '')}
                />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Result count while filtering */}
        {hasActiveFilters ? (
          <p className="text-[10px] text-text-muted tabular-nums px-0.5">
            {filteredConversations.length} of {conversations.length}
          </p>
        ) : null}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!loading && hasActiveFilters && filteredConversations.length === 0 && conversations.length > 0 ? (
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
            activeId={activeId}
            onView={handleView}
            onResume={handleResume}
          />
        )}
      </div>
    </div>
  );
});
ConversationPanel.displayName = 'ConversationPanel';

export default ConversationPanel;
