import { Download, ExternalLink, Server, Star } from 'lucide-react';
import React, { useCallback } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- market card opens repo via browser API
import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import type { McpRegistrySummary } from '@/features/library/api/libraryApi';
import { cn } from '@/lib/utils';
import { Button } from '@/ui';

interface McpMarketCardProps {
  server: McpRegistrySummary;
  isInstalled: boolean;
  onInstall: (name: string) => void;
}

/** Compact metric formatting: 1.2K / 3.4M (matches MarketSkillCard's installs). */
function formatMetric(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/** "YYYY-MM-DD" from an RFC3339 timestamp (registry `updatedAt`). */
function formatDate(rfc3339: string): string {
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * MCP marketplace card — 与 `SkillCard`（SkillListSection 网格视图）逐项对齐：
 * `min-h-[160px]` 卡片、`text-[13px]` 标题 + hover 外链、`text-[12px]` 两行描述、
 * transports 徽章（`self-start` 无描边，对齐 tag chips）、底部 border-t 分隔
 * （左来源位 = 图标 + truncate，右按钮 = 描边样式）。
 * registry 不提供下载量/热度字段，左来源位展示 version + repository。
 */
const McpMarketCard: React.FC<McpMarketCardProps> = React.memo(
  ({ server, isInstalled, onInstall }) => {
    const handleInstall = useCallback(() => {
      onInstall(server.name);
    }, [server.name, onInstall]);

    const handleOpenRepo = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!server.repository) return;
        try {
          // Tauri WebView 中 window.open('_blank') 会被拦截 → 走系统默认浏览器
          await openInDefaultBrowser(server.repository);
        } catch (err) {
          console.error('Failed to open repository:', err);
        }
      },
      [server.repository],
    );

    return (
      <div
        className={cn(
          'group flex flex-col h-full min-h-[160px] rounded-lg bg-bg-primary',
          'transition-colors duration-150 border',
          isInstalled ? 'border-accent-blue/50' : 'border-border hover:bg-bg-hover',
        )}
      >
        <div className="flex flex-col flex-1 gap-2 px-3.5 pt-3.5 pb-2 min-h-0">
          {/* 标题行（对齐 SkillCard：text-[13px] + hover 外链 + deprecated 徽章） */}
          <div className="flex items-center gap-2">
            <h3 className="flex-1 min-w-0 text-[13px] font-semibold text-text-primary truncate leading-none">
              {server.title}
            </h3>
            {server.status === 'deprecated' && (
              <span className="shrink-0 inline-flex items-center text-[10px] leading-none px-1.5 py-1 rounded-md font-semibold bg-accent-red/12 text-accent-red">
                Deprecated
              </span>
            )}
            {server.repository && (
              <button
                type="button"
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Open repository"
                onClick={handleOpenRepo}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 描述 — 固定占两行（对齐 SkillCard） */}
          {server.description && (
            <p
              className="text-[12px] leading-relaxed line-clamp-2 min-h-[2.5em] text-text-secondary"
              title={server.description}
            >
              {server.description}
            </p>
          )}

          {/* transports 徽章 — 对齐 SkillCard tag chips：self-start 无描边、gap-1 */}
          {server.transports.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {server.transports.map((t) => (
                <span
                  key={t}
                  className="inline-flex self-start text-[11px] leading-none px-2 py-1 rounded-md font-medium bg-accent-blue/10 text-accent-blue"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 底部条 — 对齐 SkillCard：左来源位（图标 + truncate）+ 指标 + 右按钮 */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <div className="flex items-center gap-1 min-w-0 flex-1 text-text-muted">
            {server.repository ? (
              <span className="inline-flex items-center gap-1 min-w-0">
                <Server className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">
                  {server.repository.replace('https://github.com/', '')}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 min-w-0">
                <Server className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{server.name}</span>
              </span>
            )}
          </div>

          {/* 热度指标：GitHub stars + 包下载量 + 更新时间（数据不可用时隐藏） */}
          <div className="flex items-center gap-2 shrink-0 text-text-muted">
            {server.updatedAt && (
              <span
                className="inline-flex items-center gap-1 tabular-nums"
                title={`Last updated ${server.updatedAt}`}
              >
                {formatDate(server.updatedAt)}
              </span>
            )}
            {server.stars != null && (
              <span className="inline-flex items-center gap-1 tabular-nums" title="GitHub stars">
                <Star className="h-3 w-3 shrink-0 opacity-70" />
                {formatMetric(server.stars)}
              </span>
            )}
            {server.downloads != null && (
              <span
                className="inline-flex items-center gap-1 tabular-nums"
                title="Downloads (last month)"
              >
                <Download className="h-3 w-3 shrink-0 opacity-70" />
                {formatMetric(server.downloads)}
              </span>
            )}
          </div>

          {isInstalled ? (
            <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold border text-text-muted border-border bg-bg-hover">
              Installed
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleInstall}
              className="shrink-0 h-6 px-2 text-[11px] font-semibold text-accent-blue border border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20"
              title="MCP servers can execute arbitrary code. Review the generated config before installing."
            >
              Install
            </Button>
          )}
        </div>
      </div>
    );
  },
);

McpMarketCard.displayName = 'McpMarketCard';

export default McpMarketCard;
