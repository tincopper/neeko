import { ArrowLeft } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import InlineRenameInput from '@/shared/components/InlineRenameInput';
import type { TeamSnapshot } from '@/shared/types/team';

import { memberCountOf } from '../utils/memberCount';
import { hasResumableMember } from '../utils/memberTerminal';
import { renameDraftCommit } from '../utils/renameDraft';
import { awaitingApprovalCount } from '../utils/taskBoard';
import { projectRootTail } from '../utils/teamList';

import TeamHeaderMenu from './TeamHeaderMenu';
import TeamStateBadge from './TeamStateBadge';

/**
 * 团队视图的头部：**两行说清「哪个队、几个人、有几件事等人动手」**（R1 / R2）。
 *
 * ```
 * [←]  队名（双击改名）              [状态徽标] [⋯]
 * 4 成员 · 1 待批 · feat-team
 * ```
 *
 * | 元素 | 来源 | 为什么在这一行 |
 * | --- | --- | --- |
 * | 队名 | `snapshot.team.name`（拉不到时退化成 teamId）| 身份 |
 * | 状态徽标 | `teamStateBadge`（三态，`closing` 不许并进 `active`）| 能不能派活 |
 * | `N 成员` | `memberCountOf(snapshot)`（**后端口径**：不含队长）| 规模（降级成 meta 文字）|
 * | `M 待批` | `awaitingApprovalCount(snapshot.tasks)`（**只有 > 0 时出现**）| 有多少件事等人动手 |
 * | 项目根末段 | `projectRootTail(projectPath)`，完整路径进 `title` | 多个 worktree 之间区分团队 |
 *
 * # 为什么低頻入口进了 `⋯` 菜单
 *
 * dock 右栏只有 260–300px。`返回列表` 之后还要排 `改名` / `恢复团队` / `关闭团队` 三个文字
 * 按钮，队名就被压到十几个字符。它们各自的替代入口也都还在：
 *
 * | 动作 | 替代入口 |
 * | --- | --- |
 * | 改名 | **双击队名**（同一份 `handleStartRename`）|
 * | 刷新 | `usePulseRefresh` 自动刷新；菜单里的「刷新快照」是通道异常时的手动恢复路径 |
 * | 恢复团队 | 只在 `open` 且存在可恢复成员时成立（判据同花名册按钮）|
 * | 关闭团队 | 菜单项，破坏性动作单独着色 + 分隔线（见 [`TeamHeaderMenu`]）|
 *
 * 菜单项**走同一批回调 prop**（不新增状态、不新写实现）：`onRenameTeam` / `onResumeTeam` /
 * `onRefresh` / `onRequestClose` 全部来自 `TeamView` → `TeamPanel` 的既有接线。
 *
 * # 为什么「恢复团队」不是「关闭团队」的对称按钮
 *
 * 恢复**只能**发生在 `open` 的队上，而且只在「至少一个成员有原生会话 id、进程不在、未被
 * 封存」时才有意义（判据来自 `hasResumableMember` —— 它与花名册的按钮**同一份**推导）。
 * 一个「没有可恢复成员」的队渲染这个入口，用户点下去得到的是一句「恢复 0 个成员」；
 * 永远亮着的入口与「0 待批」同一条纪律：提示只在它成立时出现。
 *
 * # 为什么「M 待批」只在 > 0 时出现
 *
 * 「0 待批」是一条永远亮着的提示，读两次之后就不再读 —— 于是真有 1 条待批时也不会被看见。
 * 与「只显示前 N 条」同一条纪律：提示只在它成立时出现。
 *
 * # 项目根只摆末段
 *
 * 完整路径进 `title`：dock 右栏放不下绝对路径，而末段（分支 / 工作树目录名）才是用户在
 * 多个 worktree 之间区分团队的线索（同 `TeamListRow`）。`sealed` 时 meta 行末尾补
 * 「只读快照（不随重启恢复）」——**可见文字**，不进 title（那会变成 hover-only 信息）。
 */
interface TeamHeaderProps {
  /** 当前打开的团队（`teamStore.teamId`）。 */
  teamId: string;
  snapshot: TeamSnapshot | null;
  /** 有关闭请求在飞（菜单项置灰，避免连点）。 */
  closing: boolean;
  /** 有恢复请求在飞（整队 / 成员级共用；菜单项置灰，避免连点出两个恢复编排）。 */
  resuming: boolean;
  /**
   * 整队恢复（`team_resume`，不带 memberId）。
   *
   * `undefined` = 宿主未注入这条连线（测试环境）：菜单项不渲染，而不是渲染一个点了没反应的。
   */
  onResumeTeam?: () => void;
  /**
   * 改名（`team_rename`）：行内编辑提交一次「裁过且真的变了」的名字。
   *
   * `undefined` = 宿主未注入这条连线（测试环境）：入口不渲染，而不是渲染一个点了没反应的。
   */
  onRenameTeam?: (name: string) => void;
  onRefresh: () => void;
  /** 回列表视图（**不清** store）。 */
  onBack: () => void;
  onRequestClose: () => void;
}

const TeamHeader: React.FC<TeamHeaderProps> = React.memo(
  ({
    teamId,
    snapshot,
    closing,
    resuming,
    onResumeTeam,
    onRenameTeam,
    onRefresh,
    onBack,
    onRequestClose,
  }) => {
    const state = snapshot?.team.state ?? null;
    const teamName = snapshot?.team.name ?? teamId;
    // 成员数只有一份产出点（`utils/memberCount`）：列表行用后端的 `TeamSummary.memberCount`，
    // 这里用同一口径 —— 曾经这里是 `members.length`（含队长），于是同一个队在列表上「3」、
    // 点进去「4」。快照暂时没有这一列时由该函数从花名册派生一次（见其 TODO）。
    const memberCount = snapshot === null ? 0 : memberCountOf(snapshot);
    const awaiting = snapshot ? awaitingApprovalCount(snapshot.tasks) : 0;
    const projectPath = snapshot?.team.projectPath ?? teamId;
    // 可恢复成员的判据与花名册按钮**同源**（`openTerminalAction`）—— 不在这里重算 `!live && resumable`。
    const resumable = snapshot !== null && hasResumableMember(snapshot.members);

    /** `null` = 不在编辑态（编辑态的生命周期就是那个输入框的挂载期）。 */
    const [draft, setDraft] = useState<string | null>(null);
    const handleStartRename = useCallback(() => setDraft(teamName), [teamName]);
    const handleCancelRename = useCallback(() => setDraft(null), []);
    const handleCommitRename = useCallback(() => {
      if (draft === null) return;
      const next = renameDraftCommit(draft, teamName);
      setDraft(null);
      if (next === null) return;
      onRenameTeam?.(next);
    }, [draft, onRenameTeam, teamName]);

    return (
      // 两行：身份 + meta。第三行会让 260–300px 的列白掉 30+ px（R1）
      <header className="flex flex-col gap-0.5 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回列表"
            title="返回列表"
            className="grid size-5 shrink-0 place-items-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <ArrowLeft size={13} aria-hidden="true" />
          </button>
          {draft === null ? (
            <span
              className="min-w-0 flex-1 truncate text-ui font-semibold text-text-primary"
              // 双击改名（菜单里的「改名」仍是主入口：双击对键盘 / 读屏用户不存在）
              onDoubleClick={handleStartRename}
              title="双击改名"
            >
              {teamName}
            </span>
          ) : (
            <InlineRenameInput
              value={draft}
              onChange={setDraft}
              onCommit={handleCommitRename}
              onCancel={handleCancelRename}
            />
          )}
          {/* 徽标文案来自唯一映射点（`teamStateBadge`），不在这里另写一份 */}
          {state === null ? null : <TeamStateBadge state={state} />}
          <TeamHeaderMenu
            teamName={teamName}
            state={state}
            resumable={resumable}
            closing={closing}
            resuming={resuming}
            // 「改名」与双击共用**同一个** handler（不产生第二个编辑态来源）
            onRename={onRenameTeam === undefined ? undefined : handleStartRename}
            onRefresh={onRefresh}
            onResumeTeam={onResumeTeam}
            onRequestClose={onRequestClose}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-micro text-text-muted">
          <span>{`${memberCount} 成员`}</span>
          {awaiting > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span data-awaiting={awaiting} className="font-semibold text-accent-yellow">
                {`${awaiting} 待批`}
              </span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate font-mono" title={projectPath}>
            {projectRootTail(projectPath)}
          </span>
          {state === 'sealed' ? (
            <>
              <span aria-hidden="true">·</span>
              {/* 这句话不能只进 title：它解释「为什么这里什么都不能做」 */}
              <span>只读快照（不随重启恢复）</span>
            </>
          ) : null}
        </div>
      </header>
    );
  },
);
TeamHeader.displayName = 'TeamHeader';

export default TeamHeader;
