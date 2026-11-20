import React, { useCallback, useState } from 'react';

import type { TeamSession } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { Island } from '@/ui/Island';

import { useTeamCrossDomainCallbacks } from '../hooks/useTeamCrossDomainCallbacks';
import { useTeamDestructives } from '../hooks/useTeamDestructives';
import { useTeamList } from '../hooks/useTeamList';
import { useTeamPanel } from '../hooks/useTeamPanel';
import { useTeamRename } from '../hooks/useTeamRename';
import { useTeamResumePanel } from '../hooks/useTeamResumePanel';
import { useTeamStore } from '../store/teamStore';

import TeamConfirmDialog from './TeamConfirmDialog';
import TeamLaunchPanel from './TeamLaunchPanel';
import TeamListPage from './TeamListPage';
import TeamPanelErrors from './TeamPanelErrors';
import TeamView from './TeamView';

/**
 * 团队面板（dock 右栏形态）：**列表优先 + 视图推入** 的导航模型（2026-11-08，
 * 替代旧的「队长入口 | 已有团队」上下分栏 —— 建队表单常驻首屏把列表挤走，已否决）。
 *
 * # 三个互斥视图，一份真相
 *
 * | 视图 | 何时 | 内容 |
 * | --- | --- | --- |
 * | 列表态（主面）| `teamId === null` 且未在创建流 | 页头（新建常驻入口）+ 团队卡片（[`TeamListPage`]）|
 * | 新建态 | 页头「新建团队」推入 | 创建流（[`TeamLaunchPanel`]，← 返回退栈，草稿不清）|
 * | 团队 | 打开了某个队 | 头部（关闭 / 返回列表 / 刷新）+ 横幅 + 花名册 + 任务板 |
 *
 * 看板 / 分配图可再推入**中央 tab**（`onOpenBoard`）—— 300px 列装不下整张板。
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
 * | 关闭（`team_close`）| **可重试**：失败停在 `closing` | 非 `sealed` | 不清 store + 重取快照与列表 |
 * | 删除（`team_delete`）| **不可逆**：行 + 成员 + 任务 + 审计一起没 | 只 `sealed` | 只重取列表 |
 *
 * 与它们并列的还有**恢复**（`team_resume`，`useTeamResume`）：它不是破坏性动作，但同样是
 * 团队级的写操作 —— 入口在头部（整队）与花名册 / 抽屉（成员级），两条都走**同一个** hook
 * 实例，所以「有没有恢复在飞」只有一个答案。它的错误与关闭错误同族：入口在团队视图里，
 * 所以错误也挂在团队视图的顶栏（与 `closeError` 并列，不互相遮蔽）。
 *
 * # 「恢复会话 = 打开会话」（只对成员级）
 *
 * 成员级恢复的落点是它那个终端（开关与判据都在 `useTeamResumePanel`，含整队为什么不这么做）。
 *
 * 三个裁决都落在「失败时不假装成功」上（细则见 [`TeamConfirmDialog`] / [`useTeamClose`] /
 * [`TeamView`] 各自的文档）：二次确认说清后果；失败不清 store（团队停在可查询的 `closing`）；
 * `closing` 是一条带「重试关闭」的横幅。
 */
interface TeamPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 把队长 PTY 接进 dock 终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenLeaderTerminal?: (
    session: TeamSession,
    title: string,
    /** 队长的 agent（tab 栏品牌图标用）。 */
    agentId: string | undefined,
  ) => void;
  /**
   * 把**任意一个成员**的 PTY 接进 dock 终端（花名册行上的「打开会话」）。
   *
   * 与 `onOpenLeaderTerminal` 的区别只是入口（自动打开 vs 用户按下），语义不合并。
   * 第三个参数是**这个团队自己的项目 id**（`snapshot.team.projectId`），由本组件绑定，
   * 而不是让宿主去取「当前激活项目」—— 用激活项目顶替会把终端 tab 登记到另一棵树
   * （登记错位）。`null` = 快照还没到 / v16 之前建的行。
   */
  onOpenTerminal?: (
    terminalId: string,
    title: string,
    /** 会话所属 agent（tab 栏据此显示品牌图标 —— 能看出是哪个 CLI 在跑）。 */
    agentId: string | undefined,
    projectId: ProjectId | null,
  ) => void;
  /**
   * 把当前任务视图（看板 / 分配图）作为中央 tab 打开（跨域动作，wrapper 注入：
   * projectId 的回落在 wrapper —— 与终端同一口径）。`undefined` = 未注入，按钮不渲染。
   */
  onOpenBoard?: (
    teamId: string,
    teamName: string,
    teamProjectId: ProjectId | null,
    view: 'board' | 'flow',
  ) => void;
  /**
   * 任务详情以**中央 tab**打开（跨域动作，wrapper 注入 projectId 落键）。
   * `undefined` = 未注入（卡片点击不动作 —— 测试环境）。
   */
  onOpenTaskTab?: (
    teamId: string,
    taskId: string,
    title: string,
    projectId: ProjectId | null,
  ) => void;
  /**
   * 打开已退出成员的历史会话（`conversation` tab）。
   *
   * 第四个参数是**这个团队自己的** projectId（`snapshot.team.projectId`），与
   * `onOpenTerminal` / `onOpenBoard` / `onOpenTaskTab` 同一口径：历史会话 tab 也按
   * `(projectId, 工作区)` 落键，用激活项目顶替会把 tab 登记到另一棵树。
   * `null` = 快照还没到 / v16 之前建的行，由宿主回落激活项目。
   */
  onOpenHistory?: (
    agentId: string,
    agentSessionId: string,
    title: string,
    projectId: ProjectId | null,
  ) => void;
  /**
   * 改名落地后把**已经打开的 tab 标题**跟上（跨域动作，wrapper 注入）。
   *
   * 不注入 = 只改后端那一行（tab 上的「队长 · 旧名」留着）—— 测试环境与「还没有任何 tab」
   * 是同一个形状。宿主要自己解析团队（teamId / 队长的 terminalId），本组件只报事实。
   */
  onTeamRenamed?: (teamId: string, name: string) => void;
}

const TeamPanel: React.FC<TeamPanelProps> = React.memo(
  ({
    onShowToast,
    onOpenLeaderTerminal,
    onOpenTerminal,
    onOpenBoard,
    onOpenTaskTab,
    onOpenHistory,
    onTeamRenamed,
  }) => {
    const { teamId, snapshot, loading, error } = useTeamPanel();
    const refresh = useTeamStore((s) => s.refresh);
    const openTeam = useTeamStore((s) => s.openTeam);

    const { list, loading: listLoading, error: listError, reload: reloadList } = useTeamList();

    /**
     * 导航状态（就近管理，不进 store）：
     *
     * - `browsingFrom`：用户按了「返回列表」的那个队 —— 视图由「当前队」与它**派生**
     *   （另存一个 `showList` 布尔会多出一帧不一致）；
     * - `creating`：列表态里**推入的创建流**（建队是一次性动作，不该永久占着首屏）。
     */
    const [browsingFrom, setBrowsingFrom] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    // 破坏性动作（关闭 / 删除）的组合点：确认状态 + 两个执行 hook + 唯一分派。
    const {
      closing,
      closeError,
      deleteError,
      deletingTeamId,
      pendingAction,
      handleRequestClose,
      handleRequestDelete,
      handleCancelAction,
      handleConfirmAction,
    } = useTeamDestructives({
      onShowToast,
      // 成败都重取列表：成功少一行，失败那一行的徽标 / 错误原文必须可见。
      onSettled: reloadList,
    });

    const showingTeamId = teamId !== null && browsingFrom !== teamId ? teamId : null;

    // 跨域回调的绑定层（项目落键 / 历史会话三参→四参）：四个落键点同口径，见 hook 文档。
    // 它必须比恢复的组合早定义一步：恢复成功后的落点就是它里面的 `onOpenTerminal`。
    const crossDomain = useTeamCrossDomainCallbacks({
      showingTeamId,
      snapshot,
      onOpenTerminal,
      onOpenBoard,
      onOpenTaskTab,
      onOpenHistory,
      onOpenLeaderTerminal,
    });

    /**
     * 恢复（`team_resume`）的组合点：一个面板级在飞闸门 + 两个入口（整队 / 单成员）。
     *
     * 放在这里（与 `useTeamDestructives` 并列）而不是分散在两个入口的组件里：头部只恢复
     * 整队、花名册只恢复成员，但「有没有一次恢复在飞」是一个面板级的事实。成员级的落点
     * （恢复完直接接管新 PTY）也在那个 hook 里 —— 它要求刷新已 await 落地。
     */
    const { resuming, resumeError, resumeTeam, resumeMember } = useTeamResumePanel({
      showingTeamId,
      onShowToast,
      refreshSnapshot: refresh,
      reloadList,
      onOpenTerminal: crossDomain.onOpenTerminal,
    });

    // 列表行的改名：写就完事 —— 名字的真相随 `reloadList`（与脉冲）回到列表行。
    const { rename: renameTeam } = useTeamRename({
      onShowToast,
      onRenamed: onTeamRenamed,
      onSettled: reloadList,
    });
    const handleOpenTeam = useCallback(
      (id: string) => {
        // 先在**列表里打开**的那个队：`openTeam` 对同一个 id 是幂等的，所以「返回列表后再点开
        // 同一个队」不会改 `teamId` —— 视图的复位只能显式做，不能靠 `teamId` 变化。
        setBrowsingFrom(null);
        setCreating(false);
        void openTeam(id);
      },
      [openTeam],
    );

    const handleBackToList = useCallback(() => {
      // 只切视图，不清 store：这是导航，不是关闭。创建流同理（草稿留给下次）。
      setBrowsingFrom(teamId);
      setCreating(false);
    }, [teamId]);

    const handleRefresh = useCallback(() => {
      void refresh();
    }, [refresh]);

    /** 创建流的「退栈」：只切视图，不清草稿（返回是导航）。 */
    const handleCancelCreate = useCallback(() => {
      setCreating(false);
    }, []);

    return (
      <Island className="flex h-full min-h-0 flex-col">
        {/* 两条团队级写操作的错误（关闭 / 恢复）贴顶栏、两个视图都看得见；
            各自为什么在那里见 [`TeamPanelErrors`] 的文档。 */}
        <TeamPanelErrors closeError={closeError} resumeError={resumeError} />

        {showingTeamId !== null ? (
          <TeamView
            teamId={showingTeamId}
            snapshot={snapshot}
            loading={loading}
            error={error}
            closing={closing}
            resuming={resuming}
            onRefresh={handleRefresh}
            onBack={handleBackToList}
            onRequestClose={handleRequestClose}
            onOpenTerminal={crossDomain.onOpenTerminal}
            onOpenTask={crossDomain.onOpenTask}
            onOpenBoard={crossDomain.onOpenBoard}
            onOpenHistory={crossDomain.onOpenHistory}
            onResumeMember={resumeMember}
            onResumeTeam={resumeTeam}
            onRenameTeam={renameTeam}
          />
        ) : creating ? (
          // 创建态：整面板推入的创建流（原型 ②）。做完或返回即退栈回列表。
          <TeamLaunchPanel
            onShowToast={onShowToast}
            onOpenLeaderTerminal={crossDomain.onOpenLeaderTerminal}
            onBack={handleCancelCreate}
          />
        ) : (
          // 列表态（主面）：header 给「新建」这个动作一个常驻入口，列表是主人。
          <TeamListPage
            list={list}
            listLoading={listLoading}
            listError={listError}
            deleteError={deleteError}
            onRetryList={reloadList}
            onOpenTeam={handleOpenTeam}
            onRequestClose={handleRequestClose}
            onRequestDelete={handleRequestDelete}
            deletingTeamId={deletingTeamId}
            onRequestRename={renameTeam}
            onCreate={() => setCreating(true)}
          />
        )}

        <TeamConfirmDialog
          intent={pendingAction}
          onCancel={handleCancelAction}
          onConfirm={handleConfirmAction}
        />
      </Island>
    );
  },
);
TeamPanel.displayName = 'TeamPanel';

export default TeamPanel;
