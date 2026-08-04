import { Loader2, AlertTriangle, Star, Store } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import {
  MCP_PAGE_SIZE_OPTIONS,
  useMcpMarketplace,
} from '@/features/library/hooks/useMcpMarketplace';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';

import McpMarketCard from './McpMarketCard';

const TRANSPORT_OPTIONS = ['http', 'stdio', 'sse'] as const;

const McpMarketplaceContent: React.FC = React.memo(() => {
  const {
    displayList,
    visibleList,
    loading,
    error,
    hasNext,
    hasPrev,
    currentPage,
    perPage,
    setPerPage,
    goToPage,
    nextPage,
    prevPage,
    searchQuery,
    isInstalled,
    sortMode,
    setSortMode,
    transportFilter,
    setTransportFilter,
  } = useMcpMarketplace();

  const openMcpInstall = useMcpStore((s) => s.openMcpInstall);

  const handleInstall = useCallback(
    async (name: string) => {
      try {
        const { fetchMcpRegistryServer } = await import('@/features/library/api/libraryApi');
        const detail = await fetchMcpRegistryServer(name);
        if (!detail.generated) return;
        openMcpInstall(
          {
            name: detail.summary.name,
            title: detail.summary.title,
            version: detail.summary.version,
          },
          detail.generated,
        );
      } catch (e) {
        console.error('Failed to fetch registry server detail:', e);
      }
    },
    [openMcpInstall],
  );

  // Transport options present in the current page (for the filter chips)
  const availableTransports = useMemo(() => {
    const present = new Set<string>();
    for (const s of displayList) {
      for (const t of s.transports) present.add(t);
    }
    return TRANSPORT_OPTIONS.filter((t) => present.has(t));
  }, [displayList]);

  const isEmpty = !loading && !error && visibleList.length === 0;

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {/* Safety banner */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-accent-yellow/10 border-b border-accent-yellow/20">
        <AlertTriangle className="h-3 w-3 text-accent-yellow shrink-0" />
        <span className="text-[10.5px] text-accent-yellow leading-snug">
          MCP servers can execute arbitrary code. Review the generated config before installing.
        </span>
      </div>

      {/* 过滤 / 排序行 — 对齐 Skills 市场的 SourceFilter/LeaderboardToggle 交互 */}
      {!loading && displayList.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTransportFilter(null)}
              className={cn(
                'h-6 px-2 text-[11px] rounded-md transition-colors',
                transportFilter === null
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              All
            </button>
            {availableTransports.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTransportFilter(transportFilter === t ? null : t)}
                className={cn(
                  'h-6 px-2 text-[11px] rounded-md transition-colors',
                  transportFilter === t
                    ? 'bg-bg-selected text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSortMode('recent')}
              className={cn(
                'h-6 px-2 text-[11px] rounded-md transition-colors',
                sortMode === 'recent'
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => setSortMode('alpha')}
              className={cn(
                'h-6 px-2 text-[11px] rounded-md transition-colors',
                sortMode === 'alpha'
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              A–Z
            </button>
            <button
              type="button"
              onClick={() => setSortMode('popular')}
              className={cn(
                'flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors',
                sortMode === 'popular'
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              <Star className="h-3 w-3 shrink-0" />
              Popular
            </button>
            <button
              type="button"
              onClick={() => setSortMode('downloads')}
              className={cn(
                'h-6 px-2 text-[11px] rounded-md transition-colors',
                sortMode === 'downloads'
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              Downloads
            </button>
          </div>
        </div>
      )}

      {/* Content area — 外层相对定位：翻页 loading 时叠加遮罩（保留旧内容不跳动） */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
          {loading && displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2">
              <Loader2 className="h-5 w-5 animate-spin opacity-50" />
              <span className="text-[11px]">Loading…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
              <span className="text-[var(--font-size)] text-accent-red">{error}</span>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
              <div className="w-11 h-11 rounded-xl bg-bg-hover flex items-center justify-center">
                <Store className="h-5 w-5 opacity-50" />
              </div>
              <span className="text-[var(--font-size)] text-text-secondary">
                {searchQuery || transportFilter ? 'No results' : 'No servers available'}
              </span>
            </div>
          ) : (
            <div
              className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start"
              role="list"
              aria-label={`Servers (${visibleList.length})`}
            >
              {visibleList.map((server) => (
                <div key={server.name} role="listitem" className="min-w-0 h-full">
                  <McpMarketCard
                    server={server}
                    isInstalled={isInstalled(server.name)}
                    onInstall={handleInstall}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 翻页 loading 遮罩：已有内容时叠加半透明层 + spinner，避免页面跳变 */}
        {loading && displayList.length > 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/50">
            <Loader2 className="h-5 w-5 animate-spin opacity-60" />
          </div>
        )}
      </div>

      {/* Pagination — 与 Skills 市场 Pagination 同构：范围 + 页码按钮 + prev/next + 每页条数 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between px-3 h-9 border-t border-border">
          <span className="text-[10.5px] text-text-muted tabular-nums">
            Page {currentPage} · {displayList.length} server{displayList.length !== 1 ? 's' : ''}
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={prevPage}
              disabled={!hasPrev || loading}
              className="p-1 rounded transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* 已访问页码按钮（游标栈缓存，可跳回）+ 下一页按钮 */}
            {Array.from({ length: currentPage }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                disabled={loading || p === currentPage}
                className={cn(
                  'min-w-[24px] h-6 text-[11px] rounded transition-colors',
                  p === currentPage
                    ? 'bg-bg-selected text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                  (loading || p === currentPage) && 'cursor-default',
                )}
              >
                {p}
              </button>
            ))}
            {hasNext && (
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={loading}
                className="min-w-[24px] h-6 text-[11px] rounded transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              >
                {currentPage + 1}
              </button>
            )}

            <button
              onClick={nextPage}
              disabled={!hasNext || loading}
              className="p-1 rounded transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next page"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <select
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            disabled={loading}
            title="Per page"
            className="h-6 px-1 text-[10.5px] rounded-md bg-bg-hover/60 border border-transparent text-text-muted outline-none focus:border-border"
          >
            {MCP_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});

McpMarketplaceContent.displayName = 'McpMarketplaceContent';

export default McpMarketplaceContent;
