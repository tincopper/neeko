import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useNowTick } from '@/shared/hooks/useNowTick';
import { isSameSession } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';

import SessionListRow from './SessionListRow';

/**
 * 侧栏单元下的会话子列表 —— 注册表快照的第三个投影。
 *
 * 本组件只负责分页、相对时间节拍与「当前会话必须可见」；行内视觉契约、改名、
 * hover 覆盖槽状态机都在 `SessionListRow`。无会话传入 → 渲染 null。
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
  /**
   * 行内**改名**。不传 = 行尾不出现工具栏（只读列表）。
   *
   * 能力由调用方注入而不是本组件自己 invoke：`shared/` 不得依赖 `features/`
   * （分层约束），与 `SessionRow` 的 `renderUnitSessions` 同一条理由。
   */
  onRename?: (session: SessionView, title: string) => void;
  /** 行内**删除**（确认由调用方负责 —— 那是「丢掉东西」的统一宿主）。 */
  onDelete?: (session: SessionView) => void;
  /** 每页行数（超过它折叠，点「显示更多」再放出同样多条）。 */
  maxRows?: number;
  className?: string;
}

const SessionList: React.FC<SessionListProps> = ({
  sessions,
  onActivate,
  onRename,
  onDelete,
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
    <div className={cn('flex flex-col gap-0.5 pb-1', className)} role="list">
      {visible.map((session) => (
        <SessionListRow
          key={`${session.kind}:${session.sessionId}`}
          session={session}
          isActive={isSameSession(session, activeSession)}
          now={now}
          onActivate={onActivate}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
      {remaining > 0 ? (
        <button
          type="button"
          className="px-1.5 py-0.5 text-left text-[0.82em] text-text-muted cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => setVisibleCount((count) => count + maxRows)}
        >
          显示更多（还有 {remaining} 条）
        </button>
      ) : null}
    </div>
  );
};

export default React.memo(SessionList);
