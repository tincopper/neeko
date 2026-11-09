import React, { useCallback, useEffect, useRef, useState } from 'react';

import { AgentIcon } from '@/features/agent';
import { cn } from '@/lib/utils';
import InlineRenameInput from '@/shared/components/InlineRenameInput';
import SessionRowMenu from '@/shared/components/SessionRowMenu';
import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import { useNowTick } from '@/shared/hooks/useNowTick';
import { isNamedSession, isSameSession } from '@/shared/selectors/liveSessionSelectors';
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
 * - 标题：真标题用主色（**不画任何来源徽标** —— 标题来源是内部事实，见 design §10）。
 *   会话还没名字时**照样列出**（可见性 ≠ 命名，第 35 轮）：行只画 agent 图标 + 相对时间 +
 *   状态，不拿 agent 名或项目名编一个假标题。
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

interface SessionListRowProps {
  session: SessionView;
  isActive: boolean;
  now: number;
  onActivate?: (session: SessionView) => void;
  onRename?: (session: SessionView, title: string) => void;
  onDelete?: (session: SessionView) => void;
}

const SessionListRow: React.FC<SessionListRowProps> = ({
  session,
  isActive,
  now,
  onActivate,
  onRename,
  onDelete,
}) => {
  // agent 品牌图标的唯一来源：agent 快照的 `icon` 字段（文件名 / 绝对路径），不新造映射。
  const agentIcon = useAgentStore((s) =>
    session.agentId ? s.agents?.find((a) => a.id === session.agentId)?.icon : undefined,
  );
  const ago = formatRelativeTime(session.updatedAt, now);
  // 没有会话级标题（hook 主题 / 纯 shell 首条输入 / 用户改名都还没到）⇒ 只画图标。
  // 判据复用 `isNamedSession`（与 tab 标题、侧栏可见性同一份），不在这里重写一遍。
  // 不拿 agent 名或项目名占位：前者不可读，后者与单元行重复（行已经在单元下面）。
  const hasTitle = isNamedSession(session);
  // 无标题时按钮仍需要一个可读名字（否则屏幕阅读器只念出「2m」+ 状态）
  const fallbackLabel = session.kind === 'chat' ? '聊天会话' : '终端会话';
  const hasToolbar = Boolean(onRename || onDelete);

  // ── 行内改名 ────────────────────────────────────────────────────────────
  // 只在本地持有「正在改的那一版文本」：提交时交给调用方（它负责落地与失败处理），
  // 本组件不写 store（`shared/` 不碰能力，与会话激活同一条分层）。
  // focus + 全选、Enter/Escape/blur 三路键都在 `InlineRenameInput` 里 —— 本组件不再持有
  // 输入框 ref，也不再有「依赖草稿」的 focus effect（那正是「每键重新全选」的根因）。
  const [draft, setDraft] = useState<string | null>(null);
  const commitRename = useCallback(() => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    // 空标题不是名字（`title::admit` 也判负），未改动则不打扰后端。
    if (!next || next === session.title) return;
    onRename?.(session, next);
  }, [draft, onRename, session]);

  const rowClass = cn(
    // 「当前」由 `row-current` 一个语义类表达（强调色淡底，见 `styles/base/tailwind.css`）。
    'group/session flex w-full items-center gap-1.5 rounded-[5px] pl-2 pr-1.5 py-1 transition-colors',
    isActive ? 'row-current' : 'hover:bg-bg-hover',
  );

  // 改名时整行只剩输入框：工具栏与时间在编辑态是干扰，而且『删除』在改名中途不可达才对。
  if (draft !== null) {
    return (
      <div className={rowClass}>
        <AgentIcon
          icon={agentIcon ?? DEFAULT_AGENT_ICON}
          size={13}
          className="w-[13px] h-[13px] shrink-0 object-contain"
        />
        <InlineRenameInput
          value={draft}
          onChange={setDraft}
          onCommit={commitRename}
          onCancel={() => setDraft(null)}
          className="text-[0.92em] font-normal"
        />
      </div>
    );
  }

  return (
    // 外层是 `listitem`：一行 = 「一个会话」，而行尾工具栏是行按钮的**兄弟**节点。
    // 底色与选中态画在这一层（按钮只承担可交互部分），于是高亮不会在 `⋯` 前面断掉。
    // 语义上也正确：屏幕阅读器把「会话标题 + 操作按钮」读成一个列表项，而不是两件事。
    <div className={rowClass} role="listitem">
      <button
        type="button"
        aria-current={isActive}
        className={cn(
          // 密度对齐原型（`.session`：4px/6px、gap 6px、radius 5px、11.5px）：
          // 会话行是单元的**子项**，字号比单元标签小一档才有层级。
          'flex min-w-0 flex-1 items-center gap-1.5 text-left',
          'cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-blue',
        )}
        title={hasTitle ? session.title : undefined}
        aria-label={hasTitle ? undefined : fallbackLabel}
        onClick={() => onActivate?.(session)}
        onDoubleClick={() => {
          // 双击改名：与 worktree 行的「双击标签重命名」同一手感（省一次开菜单）。
          if (hasTitle && onRename) setDraft(session.title);
        }}
      >
        <AgentIcon
          icon={agentIcon ?? DEFAULT_AGENT_ICON}
          size={13}
          className="w-[13px] h-[13px] shrink-0 object-contain"
        />
        {hasTitle && (
          <span className="min-w-0 flex-1 truncate text-[0.92em] text-text-primary">
            {session.title}
          </span>
        )}
        {/* 无标题时用弹性占位把「时间 + 状态点」推到行尾（与有标题时的对齐一致） */}
        {!hasTitle && <span className="flex-1" />}
        {ago && (
          <span className="shrink-0 font-mono text-[0.78em] text-text-muted tabular-nums">
            {ago}
          </span>
        )}
        <SessionStatusIcon status={session.state} size={6} />
      </button>
      {hasToolbar && (
        <SessionRowMenu
          sessionTitle={hasTitle ? session.title : fallbackLabel}
          onRename={onRename ? () => setDraft(session.title) : undefined}
          onDelete={onDelete ? () => onDelete(session) : undefined}
        />
      )}
    </div>
  );
};

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
