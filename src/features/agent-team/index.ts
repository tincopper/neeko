/**
 * Agent Team 域的公开面（**只有组件与 hook**）。
 *
 * store 不在这里 re-export：zustand store 是域的公开状态接口，消费方按约定直导
 * `@/features/agent-team/store/teamStore`（与 `src/AGENTS.md` 的导入防火墙一致）。
 */
export { default as TeamPanel } from './components/TeamPanel';
export { default as TeamBoardCenterView } from './components/TeamBoardCenterView';
export { default as TeamTaskCenterView } from './components/TeamTaskCenterView';
/**
 * 项目层的**团队容器行**（侧栏入口）。宿主（`ProjectGitSection` / `ConnectionProjectCard`）
 * 只负责给它三个能力回调，视觉与「点哪个动作」全在组件内部 —— 与 `TeamPanel` 同一套分层
 * （域组件不 import 终端域）。
 *
 * 团队行**不再挂在单元下**：成员会话的归属与它跑在哪棵树无关（`SessionAttribution`），
 * 所以团队是跨单元的容器（见 `ProjectTeamList` 的文档）。
 */
export { default as ProjectTeamList } from './components/ProjectTeamList';
export { useTeamPanel } from './hooks/useTeamPanel';
export { useTeamBoardTab } from './hooks/useTeamBoardTab';
export { useTeamTaskTab } from './hooks/useTeamTaskTab';
/**
 * 按项目分组的团队表（`projectId → 团队列表`）。
 *
 * 侧栏三个变体（本地 / WSL·SSH）都要回答「这个项目下有哪些团队」，而分组口径只有
 * `utils/teamList.ts::teamsOfProject` 一处 —— 宿主只消费结果，不再各写一套归属判据。
 */
export { useTeamUnitKeys, useTeamsOfProject } from './hooks/useTeamsOfProject';
/**
 * 第二级的**当前行是不是团队**（唯一派生：前台团队会话 ∪ 用户点过的那一行）。
 *
 * 团队行拿 `useCurrentTeamId`（自己是不是当前），单元行拿 `useTeamRowSelected`（要不要让出
 * 高亮）—— 两边必须是**同一份**判据，否则就是双亮 /「当前」消失（历史两轮缺陷的同一形态）。
 */
export { useCurrentTeamId, useTeamRowSelected } from './hooks/useTeamRowCurrent';
/**
 * 二级列表里的**工作树**：被团队占用、且那一行没有自己的内容（无用户会话 / 不是当前单元）时
 * 不再重复列一条地点行（判据与取舍见 `hooks/useTeamFreeWorktrees.ts`）。
 */
export { useTeamFreeWorktrees } from './hooks/useTeamFreeWorktrees';
/**
 * 清单的**常驻读面**（一次首拉 + 一个脉冲引擎）。
 *
 * 只由侧栏的宿主（`ProjectsPanel`）调一次：侧栏常驻而团队面板不常驻，没有它清单会一直停在
 * 「还没问到」。面板侧经 `useTeamList` 复用同一实现。
 */
export { useTeamListBootstrap } from './hooks/useTeamListBootstrap';
