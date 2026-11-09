import React, { useCallback, useState } from 'react';

import { AgentIcon } from '@/features/agent';
import { cn } from '@/lib/utils';
import HoverActionSlot, { META_FADE_GROUP_CLASSES } from '@/shared/components/HoverActionSlot';
import InlineRenameInput from '@/shared/components/InlineRenameInput';
import SessionRowMenu from '@/shared/components/SessionRowMenu';
import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import { isNamedSession } from '@/shared/selectors/liveSessionSelectors';
import { useAgentStore } from '@/shared/store/agentStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { DEFAULT_AGENT_ICON } from '@/shared/utils/agents';
import { formatRelativeTime } from '@/shared/utils/relativeTime';

import { useSessionRowOverlay } from '../hooks/useSessionRowOverlay';

/**
 * 侧栏单元下的会话子行 —— 注册表快照的第三个投影。
 *
 * 视觉契约（`<prototype.html>` 的 `.session`）：
 * - 图标 = **该会话的 agent 品牌图标**（不是 kind 图标）：扫一眼就知道哪个 agent 在跑；
 *   纯 shell / 未知 agent 回落 `cli.svg`（`AgentIcon` 自带兜底，本组件不另建映射表）。
 * - 标题：真标题用主色（**不画任何来源徽标** —— 标题来源是内部事实，见 design §10）。
 *   会话还没名字时**照样列出**（可见性 ≠ 命名，第 35 轮）：行只画 agent 图标 + 相对时间 +
 *   状态，不拿 agent 名或项目名编一个假标题。
 * - 相对时间取 `updatedAt`：terminal 全程 `running`，用「还在动」表达而不是伪造 Idle。
 * - 行尾默认显示相对时间；仅省略 ready / stopped 的状态点，其余状态仍常驻提醒。
 * - hover / 聚焦 / 菜单展开时由同一位置的 `⋯` 覆盖；实底与行 hover 同色遮住长标题/元信息，不画浮块、不预留额外列。
 */
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
  // 判据复用 `isNamedSession`（与 tab 标题、侧栏可见性同一份），不在这里重写一遍。
  const hasTitle = isNamedSession(session);
  // 无标题时按钮仍需要一个可读名字（否则屏幕阅读器只念出「2m」+ 状态）
  const fallbackLabel = session.kind === 'chat' ? '聊天会话' : '终端会话';
  const hasToolbar = Boolean(onRename || onDelete);
  // 窄侧栏只省略 ready / stopped；running / awaitingApproval / failed 仍需常驻提醒。
  const showStatus = session.state !== 'ready' && session.state !== 'stopped';
  const hasMeta = Boolean(ago) || showStatus;

  const { showActions, setMenuOpen, handleActionsFocus, handleActionsBlur } =
    useSessionRowOverlay();

  // ── 行内改名 ────────────────────────────────────────────────────────────
  // 只在本地持有「正在改的那一版文本」：提交时交给调用方（它负责落地与失败处理），
  // 本组件不写 store（`shared/` 不碰能力，与会话激活同一条分层）。
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
    // hover 与「菜单/聚焦强制显示」统一铺 `bg-bg-hover`，让行尾覆盖槽不会变成孤立色块。
    'group/session relative flex w-full items-center gap-1.5 rounded-[5px] pl-2 pr-1.5 py-1 transition-colors',
    'hover:bg-bg-hover',
    !showActions && isActive && 'row-current',
    showActions && 'bg-bg-hover',
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
    // 工具栏绝对覆盖同一右端槽，不再占 flex 列；底色与选中态画在这一层，于是高亮不会在 `⋯` 前面断掉。
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
        {hasTitle ? (
          <span className="min-w-0 flex-1 truncate text-[0.92em] text-text-primary">
            {session.title}
          </span>
        ) : null}
        {/* 无标题时用弹性占位把「时间 + 需注意状态点」推到行尾（与有标题时的对齐一致） */}
        {!hasTitle ? <span className="flex-1" /> : null}
        {/* 行尾元信息：时间默认显示、状态点省略 ready / stopped；hover / 聚焦 / 菜单展开时让位给工具栏 */}
        {hasMeta ? (
          <span
            data-testid="session-row-meta"
            className={cn(
              'flex shrink-0 items-center gap-1.5 transition-opacity',
              META_FADE_GROUP_CLASSES.session,
              showActions ? 'opacity-0' : null,
            )}
          >
            {ago ? (
              <span className="shrink-0 font-mono text-[0.78em] text-text-muted tabular-nums">
                {ago}
              </span>
            ) : null}
            {showStatus ? <SessionStatusIcon status={session.state} size={6} /> : null}
          </span>
        ) : null}
      </button>
      {hasToolbar ? (
        <HoverActionSlot
          testId="session-row-actions"
          group="session"
          forceShow={showActions}
          onFocus={handleActionsFocus}
          onBlur={handleActionsBlur}
        >
          <SessionRowMenu
            sessionTitle={hasTitle ? session.title : fallbackLabel}
            onOpenChange={setMenuOpen}
            onRename={onRename ? () => setDraft(session.title) : undefined}
            onDelete={onDelete ? () => onDelete(session) : undefined}
          />
        </HoverActionSlot>
      ) : null}
    </div>
  );
};

export default React.memo(SessionListRow);
