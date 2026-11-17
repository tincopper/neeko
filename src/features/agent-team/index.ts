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
 * 单元下的团队行（侧栏入口）。宿主（`UnitSessionList`）只负责给它三个能力回调，
 * 视觉与「点哪个动作」全在组件内部 —— 与 `TeamPanel` 同一套分层（域组件不 import 终端域）。
 */
export { default as UnitTeamEntries } from './components/UnitTeamEntries';
export type { UnitTeamEntriesProps } from './components/UnitTeamEntries';
export { useTeamPanel } from './hooks/useTeamPanel';
export { useTeamBoardTab } from './hooks/useTeamBoardTab';
export { useTeamTaskTab } from './hooks/useTeamTaskTab';
/**
 * 按单元分组的团队表（`workspaceKey → 团队列表`）。
 *
 * 侧栏三个变体（本地 / WSL·SSH）都要回答「这个单元下有没有团队行」，而分组口径只有
 * `utils/teamList.ts::teamsByUnit` 一处 —— 宿主只消费结果，不再各写一套归属判据。
 */
export { useTeamsByUnit } from './hooks/useTeamsByUnit';
/**
 * 清单的**常驻读面**（一次首拉 + 一个脉冲引擎）。
 *
 * 只由侧栏的宿主（`ProjectsPanel`）调一次：侧栏常驻而团队面板不常驻，没有它清单会一直停在
 * 「还没问到」。面板侧经 `useTeamList` 复用同一实现。
 */
export { useTeamListBootstrap } from './hooks/useTeamListBootstrap';
