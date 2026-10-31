/**
 * Agent Team 域的公开面（**只有组件与 hook**）。
 *
 * store 不在这里 re-export：zustand store 是域的公开状态接口，消费方按约定直导
 * `@/features/agent-team/store/teamStore`（与 `src/AGENTS.md` 的导入防火墙一致）。
 */
export { default as TeamPanel } from './components/TeamPanel';
export { useTeamPanel } from './hooks/useTeamPanel';
