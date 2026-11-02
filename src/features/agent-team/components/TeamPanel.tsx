import React, { useCallback, useState } from 'react';

import type { TeamRef, TeamSession } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamClose } from '../hooks/useTeamClose';
import { useTeamDelete } from '../hooks/useTeamDelete';
import { useTeamList } from '../hooks/useTeamList';
import { useTeamPanel } from '../hooks/useTeamPanel';
import { useTeamStore } from '../store/teamStore';

import ErrorNotice from './ErrorNotice';
import TeamConfirmDialog, { type TeamDestructiveIntent } from './TeamConfirmDialog';
import TeamListPane from './TeamListPane';
import TeamView from './TeamView';

/**
 * 团队面板（`prototype-agent-team.html` 视图 ①，dock 右栏形态）。
 *
 * # 两个视图，一份真相
 *
 * | 视图 | 何时 | 内容 |
 * | --- | --- | --- |
 * | 列表 | `teamStore.teamId === null`，或用户按了「返回列表」| 队长入口 + **已有团队**（`team_list`），上下可拖分栏 |
 * | 团队 | 打开了某个队 | 头部（关闭 / 返回列表 / 刷新）+ 横幅 + 花名册 + 任务板 |
 *
 * # 列表页为什么是**可拖的分栏**而不是一个滚动容器
 *
 * 队长入口那一块在窄 dock 列里很高（候选清单 + 团队配置 + 团队根 + 主按钮 + 拒绝理由），
 * 而「已有团队」是用户回头找旧队时要看的东西。整页一个 `overflow-auto` 时，想看列表就得
 * 先把入口滚上去，而滚上去之后「我在看哪一层」就没有坐标了（嵌套滚动会让上一块的信息
 * 找不回来）。分栏把两层各变成一个确定高度、各自滚动的区域，比例由用户拖、由
 * `useDefaultLayout` 记住。
 *
 * # 为什么列表的入口是「返回列表」而不是清 store
 *
 * `teamStore.teamId` 回答的是「我在盯哪个队」（数据面），视图回答的是「我现在看哪一屏」
 * （导航）。把两者合成一个字段，就等于说「回列表 = 放弃这个队」—— 而用户只是想去另一个队，
 * 再回来还要重新拉一遍快照。所以导航状态是本组件的局部 state（就近管理），
 * 用 `browsingFrom` 记住「用户从哪个队按了返回」：换队 / 关闭后自动回到团队视图，不需要
 * 在任何地方补一次 `setState(false)`。
 *
 * # 单一真相
 *
 * 一切渲染来自 `TeamSnapshot`（后端推导一次）。清单来自 `team_list`，两者**不合并**：
 * 前者是「这台机器上有哪些队」（每队一行），后者是「这一个队长什么样」。合并会让每次打开
 * 面板都搬 N 份花名册与任务板。
 *
 * # 两个破坏性动作，两条判据
 *
 * | 动作 | 可逆面 | 状态判据 | 失败时 |
 * | --- | --- | --- | --- |
 * | 关闭（`team_close`）| **可重试**：失败停在 `closing` | 非 `closed` | 不清 store + 重取快照与列表（那个状态必须看得见）|
 * | 删除（`team_delete`）| **不可逆**：行 + 成员 + 任务 + 审计一起没 | 只 `closed` | 只重取列表（快照不会因一次失败的删除而变）|
 *
 * 三个裁决都落在「失败时不假装成功」上：
 *
 * 1. **二次确认**（[`TeamConfirmDialog`]）：后果在按下去之前就说清 —— 关闭侧与后端 `notes`
 *    同口径（直接关进程 / 在飞任务回 `pending` / worktree 保留 / 队长终端不关），删除侧
 *    与 `manager::delete_team` 同口径（只对 `closed` 可用 / 级联删成员与审计 / 不可撤销 /
 *    worktree 仍保留）；
 * 2. **失败不清 store**：有成员关不掉时团队停在 `closing`，那是可查询、可重试的真实状态；
 *    清掉面板只会让「成员还在跑」这件事不可见（见 [`useTeamClose`]）；
 * 3. **`closing` 是一条横幅**：带「重试关闭」，走同一条关闭路径（同一次确认）。
 */
interface TeamPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 把队长 PTY 接进 dock 终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
  /**
   * 把**任意一个成员**的 PTY 接进 dock 终端（花名册行上的「打开终端」）。
   *
   * 与 `onOpenLeaderTerminal` 的区别只是入口：队长那条是**建队成功后自动打开**（拿的是
   * `TeamSession`），这条是用户**看着花名册按的**（拿的是那里已有的 `terminalId`）。
   * 两者最终都走 `openExistingTerminalTab`，语义不合并。
   *
   * 第三个参数是**这个团队自己的项目 id**（`snapshot.team.projectId`），由本组件绑定，
   * 而不是让宿主去取「当前激活项目」：终端 tab 按 `(projectId, 工作区)` 落键，用激活项目
   * 顶替时，用户切了项目 / 工作树再点成员终端，tab 会被登记在**另一棵树**下面（进程接得上，
   * 登记错位）。`null` = 快照还没到 / v16 之前建的行（那时没有 `project_id`）。
   */
  onOpenTerminal?: (terminalId: string, title: string, projectId: ProjectId | null) => void;
}

/**
 * 花名册的「打开终端」在没注入宿主回调时的行为：**什么都不做**。
 *
 * 用恒等空实现而不是 `undefined` 判定，是为了让 `TeamView` / `TeamRoster` / `RosterRow`
 * 只需要一个必填签名 —— 少一条「这个 prop 可能是 undefined」的分支，就少一处
 * 「忘了判空」的崩溃面（测试里渲染裸 `<TeamPanel />` 也不会炸）。
 */
const noopOpenTerminal = (): void => {};

const TeamPanel: React.FC<TeamPanelProps> = React.memo(
  ({ onShowToast, onOpenLeaderTerminal, onOpenTerminal = noopOpenTerminal }) => {
    const { teamId, snapshot, detail, loading, error } = useTeamPanel();
    const refresh = useTeamStore((s) => s.refresh);
    const openTeam = useTeamStore((s) => s.openTeam);
    const openTaskDetail = useTeamStore((s) => s.openTaskDetail);
    const closeTaskDetail = useTeamStore((s) => s.closeTaskDetail);

    const { list, loading: listLoading, error: listError, reload: reloadList } = useTeamList();

    /**
     * 用户按了「返回列表」的那个队。
     *
     * 视图由「当前队」与「从哪个队返回」**派生**，不另存一个 `showList` 布尔：两个字段
     * 同时存在就会有不一致的那一帧（换了队但布尔还是 true）。
     */
    const [browsingFrom, setBrowsingFrom] = useState<string | null>(null);
    /** 待确认的**破坏性**动作（关闭 / 删除）；`null` = 弹窗关闭。 */
    const [pendingAction, setPendingAction] = useState<TeamDestructiveIntent | null>(null);

    const {
      busy: closing,
      error: closeError,
      close,
    } = useTeamClose({
      onShowToast,
      // 成败都重取列表：成功少一行，失败那一行的徽标要变成 `closing`。
      onSettled: reloadList,
    });

    const {
      deletingTeamId,
      error: deleteError,
      remove,
    } = useTeamDelete({
      onShowToast,
      // 成败都重取列表：成功少一行，失败时那一行本来还在（但可能已被另一窗口删了）。
      onSettled: reloadList,
    });

    const showingTeamId = teamId !== null && browsingFrom !== teamId ? teamId : null;

    /**
     * 这个团队的执行环境归属（`team.projectId`，**不是** `activeProjectId`）。
     *
     * 空串 = v16 之前建的行（那时环境只能靠路径前缀猜），所以它等价于「不知道」⇒ 传 `null`，
     * 由宿主决定怎么兜（`TeamPanelWrapper` 会回落到激活项目，并说明那是历史行的路）。
     */
    const teamProjectId = snapshot?.team.projectId ?? null;

    const handleOpenTerminal = useCallback(
      (terminalId: string, title: string) => {
        onOpenTerminal(terminalId, title, teamProjectId === '' ? null : teamProjectId);
      },
      [onOpenTerminal, teamProjectId],
    );

    const handleOpenTeam = useCallback(
      (id: string) => {
        // 先在**列表里打开**的那个队：`openTeam` 对同一个 id 是幂等的，所以「返回列表后再点开
        // 同一个队」不会改 `teamId` —— 视图的复位只能显式做，不能靠 `teamId` 变化。
        setBrowsingFrom(null);
        void openTeam(id);
      },
      [openTeam],
    );

    const handleBackToList = useCallback(() => {
      // 只切视图，不清 store：这是导航，不是关闭。
      setBrowsingFrom(teamId);
    }, [teamId]);

    const handleRefresh = useCallback(() => {
      void refresh();
    }, [refresh]);

    const handleOpenTask = useCallback(
      (teamId: string, taskId: string) => {
        // **只有这里**会触发 `team_task_detail`（红线 4：点开才拉）。
        // 两个参数都来自被点的那张卡片：任务 id 只在队内唯一，所以「打开 t1」本身
        // 不是一个完整的请求（后端的 `team_task_detail(team_id, task_id)` 也是两个）。
        void openTaskDetail(teamId, taskId);
      },
      [openTaskDetail],
    );

    const handleRequestClose = useCallback((team: TeamRef) => {
      setPendingAction({ kind: 'close', teamId: team.teamId, name: team.name });
    }, []);

    const handleRequestDelete = useCallback((team: TeamRef) => {
      setPendingAction({ kind: 'delete', teamId: team.teamId, name: team.name });
    }, []);

    const handleCancelAction = useCallback(() => {
      setPendingAction(null);
    }, []);

    /**
     * 确认后分派到两个执行 hook —— **唯一分派点**。
     *
     * 弹窗只负责「问」，它不知道关闭与删除的差异；两个 hook 也不认识对方。分派在这里是因为
     * 这里是它们唯一的共同祖先（本组件持着两个 hook 的返回值）。
     */
    const handleConfirmAction = useCallback(() => {
      const target = pendingAction;
      setPendingAction(null);
      if (!target) return;
      if (target.kind === 'delete') {
        void remove(target.teamId, target.name);
        return;
      }
      void close(target.teamId, target.name);
    }, [pendingAction, close, remove]);

    return (
      <div className="flex h-full min-h-0 flex-col bg-bg-primary">
        {/* 关闭失败的后端原文（逐个点名关不掉的成员）**两个视图都要看得见**：
            「关闭」在团队视图（头部 / closing 横幅的「重试关闭」）与列表行上都能发起，
            所以它的错误不能挂在某一个视图上。失败时团队停在 `closing`，用户需要这句话
            才知道「重试有没有用」。

            删除错误则相反 —— 它只可能来自列表行，所以渲染在 `TeamListPane` 里（贴着行）。
            把两条错误做成「按视图二选一」的单一槽位，就会让从列表行发起的关闭失败
            **一个字都不显示**（这正是回归的形状）。 */}
        <ErrorNotice message={closeError} className="shrink-0 border-b border-border px-2 py-1" />

        {showingTeamId !== null ? (
          <TeamView
            teamId={showingTeamId}
            snapshot={snapshot}
            loading={loading}
            error={error}
            detail={detail}
            closing={closing}
            onRefresh={handleRefresh}
            onBack={handleBackToList}
            onRequestClose={handleRequestClose}
            onOpenTerminal={handleOpenTerminal}
            onOpenTask={handleOpenTask}
            onCloseTaskDetail={closeTaskDetail}
          />
        ) : (
          // 列表页 = 上下可拖分栏（队长入口 | 已有团队）。分栏与滚动细节在 `TeamListPane`：
          // 那是**呈现**，而「两个视图怎么切」是这里唯一的职责。
          <TeamListPane
            list={list}
            listLoading={listLoading}
            listError={listError}
            onRetryList={reloadList}
            deleteError={deleteError}
            onOpenTeam={handleOpenTeam}
            onRequestClose={handleRequestClose}
            onRequestDelete={handleRequestDelete}
            deletingTeamId={deletingTeamId}
            onShowToast={onShowToast}
            onOpenLeaderTerminal={onOpenLeaderTerminal}
          />
        )}

        <TeamConfirmDialog
          intent={pendingAction}
          onCancel={handleCancelAction}
          onConfirm={handleConfirmAction}
        />
      </div>
    );
  },
);
TeamPanel.displayName = 'TeamPanel';

export default TeamPanel;
