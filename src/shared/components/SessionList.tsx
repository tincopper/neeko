import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import AgentIcon from '@/shared/components/AgentIcon';
import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import { useNowTick } from '@/shared/hooks/useNowTick';
import { isSameSession } from '@/shared/selectors/liveSessionSelectors';
import { useAgentStore } from '@/shared/store/agentStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { DEFAULT_AGENT_ICON } from '@/shared/utils/agents';
import { formatRelativeTime } from '@/shared/utils/relativeTime';

/**
 * 侧栏单元下的会话子列表 —— 注册表快照的第三个投影。
 *
 * 视觉契约（`<prototype.html>` 的 `.session`）：
 * - 图标 = **该会话的 agent 品牌图标**（不是 kind 图标）：扫一眼就知道哪个 agent 在跑；
 *   纯 shell / 未知 agent 回落 `cli.svg`（`AgentIcon` 自带兜底，本组件不另建映射表）。
 * - 标题：`titleSource === 'placeholder'` 时斜体 + 次级灰（**不画任何来源徽标** ——
 *   标题来源是内部事实，见 design §10）。
 * - 相对时间取 `updatedAt`：terminal 全程 `running`，用「还在动」表达而不是伪造 Idle。
 * - **无会话传入 → 渲染 null**（无会话不画点，也不留空壳）。
 */

/**
 * 每页行数：一个单元的会话超过它就折叠，点「显示更多」**一次再放出这么多条**。
 *
 * 10 是「一眼能扫完、又不至于占满侧栏」的量级；分页而不是「全部展开」，
 * 是因为一个跑了很久的单元可能有几十条会话。
 */
const DEFAULT_MAX_ROWS = 10;

/**
 * 相对时间的刷新节拍。
 *
 * 标签是 `now` 的函数，而快照不变时组件不重渲染 —— 没有节拍的话，一个空闲 3 小时的
 * 会话会一直显示「刚刚」。取 10s：小于最小的标签粒度（`刚刚` 是 5s），且列表只在
 * 单元展开时挂载，代价可以忽略。
 */
const RELATIVE_TIME_TICK_MS = 10_000;

export interface SessionListProps {
  sessions: readonly SessionView[];
  /** 点击会话行：由调用方决定激活哪个 tab（本组件不碰 store / 环境）。 */
  onActivate?: (session: SessionView) => void;
  /**
   * 当前前台 tab 对应的会话（`null` = 无前台会话），仅用于高亮。
   *
   * 收**整条会话**而不是 id：同一条身份由 `kind` + `sessionId` 共同决定
   * （`isSameSession`），只比 id 就是第二套判据。
   */
  activeSession?: SessionView | null;
  /** 每页行数（超过它折叠，点「显示更多」再放出同样多条）。 */
  maxRows?: number;
  className?: string;
}

interface SessionListRowProps {
  session: SessionView;
  isActive: boolean;
  now: number;
  onActivate?: (session: SessionView) => void;
}

const SessionListRow: React.FC<SessionListRowProps> = ({ session, isActive, now, onActivate }) => {
  // agent 品牌图标的唯一来源：agent 快照的 `icon` 字段（文件名 / 绝对路径），不新造映射。
  const agentIcon = useAgentStore((s) =>
    session.agentId ? s.agents?.find((a) => a.id === session.agentId)?.icon : undefined,
  );
  const ago = formatRelativeTime(session.updatedAt, now);
  // 没有会话级标题（CLI 还没给出 hook 主题 / 首条 prompt 未到）⇒ 只画图标。
  // 不拿 agent 名或项目名占位：前者不可读，后者与单元行重复（行已经在单元下面）。
  const hasTitle = session.title.trim().length > 0;
  // 无标题时按钮仍需要一个可读名字（否则屏幕阅读器只念出「2m」+ 状态）
  const fallbackLabel = session.kind === 'chat' ? '聊天会话' : '终端会话';

  return (
    <button
      type="button"
      aria-current={isActive}
      className={cn(
        // 密度对齐原型（`.session`：4px/6px、gap 6px、radius 5px、11.5px）：
        // 会话行是单元的**子项**，字号比单元标签小一档才有层级。
        'flex w-full items-center gap-1.5 rounded-[5px] pl-2 pr-1.5 py-1 text-left transition-colors',
        'cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-blue',
        // 选中态由 `row-current` 一个语义类表达（强调色淡底 + 左侧 2px 色条，
        // 见 `styles/components/session-row.css`）。父级用中性色，两级分属不同通道。
        isActive ? 'row-current' : 'hover:bg-bg-hover',
      )}
      title={hasTitle ? session.title : undefined}
      aria-label={hasTitle ? undefined : fallbackLabel}
      onClick={() => onActivate?.(session)}
    >
      <AgentIcon
        icon={agentIcon ?? DEFAULT_AGENT_ICON}
        size={13}
        className="w-[13px] h-[13px] shrink-0 object-contain"
      />
      {hasTitle && (
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[0.92em]',
            // 占位来源（理论上已为空）只降一档颜色；真标题用主色
            session.titleSource === 'placeholder' ? 'text-text-secondary' : 'text-text-primary',
          )}
        >
          {session.title}
        </span>
      )}
      {/* 无标题时用弹性占位把「时间 + 状态点」推到行尾（与有标题时的对齐一致） */}
      {!hasTitle && <span className="flex-1" />}
      {ago && (
        <span className="shrink-0 font-mono text-[0.78em] text-text-muted tabular-nums">{ago}</span>
      )}
      <SessionStatusIcon status={session.state} size={6} />
    </button>
  );
};

const SessionList: React.FC<SessionListProps> = ({
  sessions,
  onActivate,
  activeSession = null,
  maxRows = DEFAULT_MAX_ROWS,
  className,
}) => {
  // 可见条数：初值一页；「显示更多」每次 +一页（不是一次全放开）。
  const [visibleCount, setVisibleCount] = useState(maxRows);
  // 新会话出现（条数增长）⇒ 回到第一页：它是**最新**的那条，后端已按开始时间倒序排在前面，
  // 若不重置，用户会「看不到刚出现的会话」。
  const previousTotal = useRef(sessions.length);
  useEffect(() => {
    if (sessions.length > previousTotal.current) setVisibleCount(maxRows);
    previousTotal.current = sessions.length;
  }, [sessions.length, maxRows]);

  // 单个定时器服务整张列表：每行各起一个 setInterval 会把「刷新相对时间」变成 N 个时钟。
  const now = useNowTick(RELATIVE_TIME_TICK_MS);
  if (sessions.length === 0) return null;

  // 当前会话必须可见：父行是否让出选中态取决于「子行真的画出来了」，
  // 分页把当前行藏到后续页会让整个侧栏失去「当前」提示。
  const activeIndex = activeSession
    ? sessions.findIndex((session) => isSameSession(session, activeSession))
    : -1;
  const effectiveVisibleCount =
    activeIndex >= 0 ? Math.max(visibleCount, activeIndex + 1) : visibleCount;
  const visible = sessions.slice(0, effectiveVisibleCount);
  const remaining = sessions.length - visible.length;

  return (
    <div className={cn('flex flex-col gap-0.5 pb-1', className)}>
      {visible.map((session) => (
        <SessionListRow
          key={`${session.kind}:${session.sessionId}`}
          session={session}
          isActive={isSameSession(session, activeSession)}
          now={now}
          onActivate={onActivate}
        />
      ))}
      {remaining > 0 && (
        <button
          type="button"
          className="px-1.5 py-0.5 text-left text-[0.82em] text-text-muted cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => setVisibleCount((count) => count + maxRows)}
        >
          显示更多（还有 {remaining} 条）
        </button>
      )}
    </div>
  );
};

export default React.memo(SessionList);
