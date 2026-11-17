import React, { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView } from '@/shared/types/team';

import { useDrawerFocus } from '../hooks/useDrawerFocus';
import { useMemberDetail } from '../hooks/useMemberDetail';
import { memberRoleLabel } from '../utils/memberBadge';
import { memberChips } from '../utils/memberChips';
import { openTerminalAction } from '../utils/memberTerminal';

import Chip from './Chip';
import ErrorNotice from './ErrorNotice';
import MemberApprovalQueue from './MemberApprovalQueue';
import MemberAvatar from './MemberAvatar';
import MemberDetailTasks from './MemberDetailTasks';
import MemberEventList from './MemberEventList';
import MemberStateBadge from './MemberStateBadge';

/**
 * 租约走动的节拍（毫秒）。
 *
 * # 为什么定时器在这个组件里，而不是全局
 *
 * 「剩余多久」每秒都会变，而快照/脉冲**不会**因为时间流逝而变（后端只在写路径发脉冲）。
 * 若用一个全局定时器驱动整块面板，抽屉没打开时也在每秒重渲染花名册与任务板 —— 那是白烧的
 * 帧。这里只在**抽屉打开期间**存在一个 1s 定时器，`unmount` 即清（关闭抽屉 = 定时器消失）。
 *
 * 它驱动的只是「重算一次派生值」：`now` 是纯函数 `taskLeaseText(task, now)` 的输入，
 * 不是第二份状态（后端没有「剩余秒」这个字段留在前端）。
 */
export const LEASE_TICK_MS = 1000;

/**
 * 成员详情抽屉（`prototype-agent-team.html` 视图 ② 的落点）。
 *
 * # 它回答四个问题
 *
 * | 问题 | 块 |
 * | --- | --- |
 * | 这是谁 / 在哪干活 / 怎么打开它 | 头部（头像 + 名字 + 队长标记 + 四枚 chip + 六态徽标 + 打开 / 恢复 / 看记录）|
 * | 它卡在哪 | **待批队列**（AC5，置顶；空则整块不渲染）|
 * | 它手上有什么 | 当前任务（在飞 + 最近完成，带租约与回收次数）|
 * | 刚才发生了什么 | 最近事件（时间 + 类别 + 一行摘要）|
 *
 * # 数据只来自 `team_member_detail`
 *
 * 抽屉**不**从快照里拼一个「成员 + 全板任务过滤」的版本：那样「这个成员的任务」会有两个
 * 推导（前端筛一遍 vs 后端 `view.rs` 筛一遍），而两者的边界（最近的、已完成的、有界的）
 * 注定漂移。成员不在 `detail` 里时（首帧 / 换人）头部只显示 `memberId`，不假装有数据。
 *
 * # 关闭 = 什么都不留
 *
 * `onClose` 由宿主持有（`browsingFrom` 同族的导航状态）。本组件不缓存任何东西：卸载即
 * 定时器消失、`useMemberDetail` 复位，再打开时是全新的一次拉取。
 *
 * # 它是一层对话框，不是一块「更多内容」
 *
 * 抽屉盖住了花名册与任务板，而触发它的那一行**还在 DOM 里**（只是被遮住）。所以它必须
 * 按对话框的契约来：`role="dialog"` + `aria-modal="true"` + 有可访问名，焦点进入抽屉、
 * Esc 关闭、关闭后回到那一行（见 [`useDrawerFocus`]，两个抽屉共用同一份实现）。
 */
interface MemberDetailDrawerProps {
  /** 要看的成员 id。 */
  memberId: string;
  /** 打开它的那个终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /** 打开已退出成员的历史会话（`conversation` tab）。 */
  onOpenHistory?: (agentId: string, agentSessionId: string, title: string) => void;
  /**
   * 恢复这个成员（`team_resume`，成员级）。
   *
   * 抽屉与花名册**同一份判据**（`openTerminalAction`），所以它必须也接这个动作：
   * 两处各写一份三元，同一个人在两处就会有两个说法（“恢复会话” vs “打开终端”）。
   */
  onResumeMember?: (memberId: string) => void;
  onClose: () => void;
}

const MemberDetailDrawer: React.FC<MemberDetailDrawerProps> = React.memo(
  ({ memberId, onOpenTerminal, onClose, onOpenHistory, onResumeMember }) => {
    const { detail, loading, error, reload } = useMemberDetail(memberId);
    // 焦点管理（移焦 / 陷阱 / Esc / 归还）只有一份实现：两个抽屉共用 `useDrawerFocus`。
    const drawerRef = useDrawerFocus<HTMLElement>(onClose);
    /**
     * 时间基准：抽屉打开时开始走，卸载即停（`clearInterval`）。
     *
     * 初值取挂载那一刻的 `Date.now()` —— 惰性初始化，不在渲染里读两次时钟。
     */
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), LEASE_TICK_MS);
      return () => clearInterval(timer);
    }, []);

    // 首帧 / 换人时的替身：只有 id 与「还没有数据」这个事实，不编造名字与状态。
    const member: MemberStatusView | null = detail?.member ?? null;
    const action = member === null ? null : openTerminalAction(member);
    const title = member?.name ?? memberId;

    const handleOpenTerminal = useCallback(() => {
      if (member === null || action === null || !action.enabled) return;
      // 三条路（与花名册同一判据）：恢复 → 起新进程续接；历史 → 只读记录；活进程 → PTY 接管。
      if (action.kind === 'resume') {
        onResumeMember?.(member.memberId);
        return;
      }
      if (action.kind === 'archive') {
        if (member.agentSessionId !== null && member.agentId !== undefined) {
          onOpenHistory?.(member.agentId, member.agentSessionId, member.name);
        }
        return;
      }
      const terminalId = member.session.terminalId;
      if (terminalId === null) return;
      onOpenTerminal(terminalId, member.name, member.agentId);
    }, [action, member, onOpenTerminal, onOpenHistory, onResumeMember]);

    return (
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Member details: ${title}`}
        // 里面一个可聚焦元素都没有（加载中）时，焦点仍要有落点，否则 Tab 从背后继续走。
        tabIndex={-1}
        className="absolute inset-y-0 right-0 z-10 flex w-[85%] max-w-[20rem] flex-col border-l border-border bg-bg-secondary shadow-lg focus:outline-none"
      >
        <header className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <MemberAvatar memberId={memberId} name={title} agentId={member?.agentId} />
            <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text-primary">
              {title}
            </span>
            {member?.role === 'lead' ? (
              <span className="shrink-0 rounded bg-accent-blue/10 px-1 text-micro font-semibold text-accent-blue">
                {memberRoleLabel(member.role)}
              </span>
            ) : null}
            {member === null ? null : <MemberStateBadge member={member} />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close member details"
              className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
            >
              Close
            </button>
          </div>

          {member === null ? null : (
            <div className="flex flex-wrap items-center gap-1">
              {/* 同一张 chip 表（`utils/memberChips`）：抽屉与花名册不许各写一份文案 */}
              {memberChips(member).map((chip) => (
                <Chip key={chip.key} tone={chip.tone} title={chip.title}>
                  {chip.text}
                </Chip>
              ))}
              <span className="min-w-0 flex-1 truncate text-right text-micro text-text-muted">
                {action?.reason ?? ''}
              </span>
              <button
                type="button"
                onClick={handleOpenTerminal}
                disabled={action === null || !action.enabled}
                aria-label={
                  action === null ? `Open session: ${title}` : `${action.label}: ${title}`
                }
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold',
                  'text-accent-blue hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent',
                )}
              >
                {/* 文案来自判据本身（`打开会话` / `恢复会话` / `查看记录`）：写死一个
                    「打开终端」会让抽屉与花名册同一个人两种说法。 */}
                {action === null ? 'Open terminal' : action.label}
              </button>
            </div>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 py-1.5">
          {/* 后端原文 + 重试（形态与队长入口 / 团队配置 / 团队列表共用 `ErrorNotice`） */}
          <ErrorNotice message={error} onRetry={reload} />

          {detail === null ? (
            <p className="text-meta text-text-muted">
              {loading ? 'Loading member details…' : 'No member details yet'}
            </p>
          ) : (
            <>
              {/* AC5：待批队列置顶（空则整块不渲染，见 `MemberApprovalQueue`） */}
              <MemberApprovalQueue
                tasks={detail.awaitingApproval}
                member={detail.member}
                onOpenTerminal={onOpenTerminal}
                onResumeMember={onResumeMember}
              />
              <MemberDetailTasks tasks={detail.tasks} truncated={detail.tasksTruncated} now={now} />
              <MemberEventList events={detail.events} truncated={detail.eventsTruncated} />
            </>
          )}
        </div>
      </aside>
    );
  },
);
MemberDetailDrawer.displayName = 'MemberDetailDrawer';

export default MemberDetailDrawer;
