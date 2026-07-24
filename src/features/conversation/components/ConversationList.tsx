import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ConversationItem from './ConversationItem';
import ConversationListSkeleton from './ConversationListSkeleton';
import { groupConversationsByDate } from '../utils/groupByDate';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationListProps {
  conversations: ConversationMeta[];
  agents: AgentConfig[];
  /** Hard loading: no rows yet (first hydrate / first scan). */
  loading: boolean;
  /** Soft background refresh; list stays visible. */
  refreshing?: boolean;
  /** More pages available for infinite scroll. */
  hasMore?: boolean;
  /** Next page in flight. */
  loadingMore?: boolean;
  /** Request next page when sentinel is visible. */
  onLoadMore?: () => void;
  activeId?: string | null;
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
}

const ConversationList: React.FC<ConversationListProps> = React.memo(({
  conversations,
  agents,
  loading,
  refreshing = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  activeId,
  onView,
  onResume,
}) => {
  const handleView = useCallback((meta: ConversationMeta) => {
    onView(meta);
  }, [onView]);

  const handleResume = useCallback((meta: ConversationMeta) => {
    onResume(meta);
  }, [onResume]);

  const groups = useMemo(
    () => groupConversationsByDate(conversations),
    [conversations],
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore || loadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;

    // History list scrolls inside a nested overflow container, not the viewport.
    let root: Element | null = el.parentElement;
    while (root) {
      const style = window.getComputedStyle(root);
      const oy = style.overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') break;
      root = root.parentElement;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onLoadMore();
        }
      },
      { root, rootMargin: '120px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, conversations.length]);

  // Fishbone: empty + still loading/refreshing → skeleton, never flash empty state early.
  if (loading || (conversations.length === 0 && refreshing)) {
    return <ConversationListSkeleton />;
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <p className="text-xs text-text-secondary/60">No conversations yet</p>
        <p className="text-[11px] text-text-secondary/40 text-center px-4">
          Start chatting with an agent to see your conversations here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col py-1 relative">
      {refreshing ? (
        <div className="sticky top-0 z-20 flex justify-center pointer-events-none">
          <span className="text-[10px] text-text-muted bg-bg-primary/90 px-2 py-0.5 rounded-b-md border border-border/60 border-t-0">
            Updating…
          </span>
        </div>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col">
          <h4
            className={
              'sticky top-0 z-10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ' +
              'text-text-muted bg-bg-primary/95 backdrop-blur-sm'
            }
          >
            {group.label}
          </h4>
          <div className="flex flex-col px-1">
            {group.items.map((meta) => (
              <ConversationItem
                key={meta.id}
                meta={meta}
                agents={agents}
                active={activeId === meta.id}
                onView={handleView}
                onResume={handleResume}
              />
            ))}
          </div>
        </section>
      ))}
      {hasMore ? (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-3 text-[10px] text-text-muted"
          aria-hidden={!loadingMore}
        >
          {loadingMore ? 'Loading more…' : 'Scroll for more'}
        </div>
      ) : null}
    </div>
  );
});
ConversationList.displayName = 'ConversationList';

export default ConversationList;
