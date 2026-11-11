import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';

import { cn } from '@/lib/utils';
import type { LaunchableAgent } from '@/shared/types/team';

import { AgentIcon } from './AgentIcon';
import ErrorNotice from './ErrorNotice';

/**
 * 队长选择区：**可启动的 CLI 是主面，被拒的是附注**。
 *
 * # 为什么把两类 CLI 分开排（不再按后端行序混排）
 *
 * 后端行序按 id 排（`team_launchable_agents` 的推导），被拒的行会插在能用的中间 ——
 * 混排时「能用的 3 个」被「不能用的 7 个 + 它们的英文理由墙」淹没，配置区和开会话按钮
 * 全被挤出首屏。分开排之后首屏即动作：上面挑队长，下面（滚动后）是配置。顺序是**呈现
 * 层**的事，判据仍在后端（`refusal` 字段），这里不维护第二套「能不能启动」。
 *
 * # 被拒的 CLI：默认**不占页面**，收进一条折叠行（2026-11-07 用户裁决）
 *
 * 用户只从这里挑能用的；被拒 CLI 的英文理由（每条 3~5 行）在默认视图里是纯噪音。
 * 所以默认视图一条理由都不渲染 —— 但**不是静默隐藏**：折叠行常驻（数量 + 名字预览，
 * 键盘可达、`aria-expanded`），点开才展开名字与完整理由。理由仍是**可见文字**
 * （不是 `title`：禁用按钮不可聚焦，触屏与键盘拿不到悬停），`aria-describedby`
 * 把理由挂回控件 —— 三条原契约在展开态原样成立。
 *
 * # 选中态用 `aria-pressed` 而不是 tablist
 *
 * 与 Tasks 头部的视图切换同一判据：这是同一个清单里的互斥选择，不是两个内容面板。
 */
interface LeadPickerSectionProps {
  /** `team_launchable_agents` 的行；`null` = 还没拿到。 */
  launchable: LaunchableAgent[] | null;
  loading: boolean;
  /** 拉取失败原文。 */
  error: string | null;
  onRetry: () => void;
  /** 当前选中的 agentId（已收敛；由面板用 `convergeAgentId` 算好）。 */
  agentId: string | null;
  onSelect: (agentId: string) => void;
  /** `agentId` → 显示名（唯一来源是 agent 快照）。 */
  nameOf: (agentId: string) => string;
}

const LeadPickerSection: React.FC<LeadPickerSectionProps> = React.memo(
  ({ launchable, loading, error, onRetry, agentId, onSelect, nameOf }) => {
    // 被拒理由的展开态（导航，就近 state）：默认折叠 —— 错误不占页面。
    // 必须在所有早退 return **之前**：hooks 的顺序在每次渲染都要一致。
    const [refusedOpen, setRefusedOpen] = useState(false);

    if (launchable === null) {
      return (
        <section aria-label="队长选择" className="flex flex-col gap-1.5">
          <h3 className="text-meta font-semibold text-text-secondary">队长用哪个 CLI</h3>
          {loading ? (
            <p className="text-meta text-text-muted">正在检查各 CLI 的启动能力…</p>
          ) : (
            <p className="text-meta text-text-muted">拿不到可启动清单，所以现在还开不了团队。</p>
          )}
          <ErrorNotice message={error} retryLabel="重新检查" onRetry={onRetry} />
        </section>
      );
    }

    const launchableRows = launchable.filter((row) => row.refusal === null);
    const refusedRows = launchable.filter((row) => row.refusal !== null);

    if (launchable.length === 0) {
      return (
        <section aria-label="队长选择" className="flex flex-col gap-1.5">
          <h3 className="text-meta font-semibold text-text-secondary">队长用哪个 CLI</h3>
          <p className="text-meta text-text-muted">
            后端没有返回任何可选的 CLI——清单为空（这不是「加载中」）。先确认 agent 配置已加载。
          </p>
          <ErrorNotice message={error} retryLabel="重新检查" onRetry={onRetry} />
        </section>
      );
    }

    return (
      <section aria-label="队长选择" className="flex flex-col gap-2">
        <h3 className="text-meta font-semibold text-text-secondary">队长用哪个 CLI</h3>

        {/* 可启动的：卡片网格（两列在 ~300px 的 dock 列里正好放下名字 + id） */}
        <ul className="grid grid-cols-2 gap-1.5" aria-label="可选的 CLI">
          {launchableRows.map((row) => {
            const selected = row.agentId === agentId;
            return (
              <li key={row.agentId}>
                <button
                  type="button"
                  onClick={() => onSelect(row.agentId)}
                  aria-pressed={selected}
                  className={cn(
                    'group flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left',
                    'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                    'transition-colors',
                    selected
                      ? 'border-accent-blue bg-accent-blue/10'
                      : 'border-border bg-bg-primary hover:border-border hover:bg-bg-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-md bg-bg-tertiary"
                  >
                    <AgentIcon agentId={row.agentId} name={nameOf(row.agentId)} size={16} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        'truncate text-meta font-medium',
                        selected ? 'text-accent-blue' : 'text-text-primary',
                      )}
                    >
                      {nameOf(row.agentId)}
                    </span>
                    <span className="truncate font-mono text-micro text-text-muted">
                      {row.agentId}
                    </span>
                  </span>
                  <Check
                    aria-hidden="true"
                    size={13}
                    strokeWidth={2.5}
                    className={cn('shrink-0', selected ? 'text-accent-blue' : 'opacity-0')}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        {/* 被拒的：默认折叠成一行（数量 + 名字预览）；点开才有完整理由 */}
        {refusedRows.length > 0 ? (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <button
              type="button"
              aria-expanded={refusedOpen}
              aria-controls="team-refused-list"
              onClick={() => setRefusedOpen((open) => !open)}
              className={cn(
                'flex items-center gap-1 rounded px-1 py-0.5 text-micro text-text-muted',
                'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
              )}
            >
              {refusedOpen ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
              <span className="shrink-0">{refusedRows.length} 个 CLI 不可用于团队</span>
              <span className="min-w-0 truncate">
                {refusedRows.map((row) => nameOf(row.agentId)).join('、')}
              </span>
            </button>
            {refusedOpen ? (
              <ul
                id="team-refused-list"
                className="flex flex-col gap-1.5"
                aria-label="不可用的 CLI"
              >
                {refusedRows.map((row) => {
                  const refusalId = `team-launch-refusal-${row.agentId}`;
                  return (
                    <li key={row.agentId} className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        aria-describedby={refusalId}
                        className={cn(
                          'flex w-full cursor-not-allowed items-center gap-1.5 rounded-md px-1.5 py-1 text-left',
                          'bg-transparent',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-micro text-text-muted">
                          {nameOf(row.agentId)}
                        </span>
                        <span className="shrink-0 font-mono text-micro text-text-muted/70">
                          {row.agentId}
                        </span>
                        <span className="shrink-0 rounded bg-bg-tertiary px-1 text-micro text-text-muted">
                          不可用
                        </span>
                      </button>
                      {/* 点开后的完整理由：可见文字（不是 title），挂回控件供读屏 */}
                      <p
                        id={refusalId}
                        className="pl-1.5 text-micro leading-relaxed text-text-muted/80"
                      >
                        {row.refusal}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}

        <ErrorNotice message={error} retryLabel="重新检查" onRetry={onRetry} />
      </section>
    );
  },
);
LeadPickerSection.displayName = 'LeadPickerSection';

export default LeadPickerSection;
