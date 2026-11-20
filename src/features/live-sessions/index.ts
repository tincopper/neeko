/**
 * live-sessions 域的公开面（跨 feature 只允许经本文件导入）。
 *
 * 该域负责：把后端注册表快照接到前端（`useLiveSessionsBridge`），并装配侧栏会话子列表
 * （`UnitSessionList`）。状态 / 标题的**事实**在后端，本域不做任何推断。
 */

export { default as UnitSessionList } from './components/UnitSessionList';
/**
 * 项目层的团队容器（装配件）。
 *
 * 宿主（本地项目卡 / WSL·SSH 连接卡）只挂它，不直接认识团队域：能力（接管 PTY / 切面板）
 * 在本域与终端域之间绑定好再注入 —— 团队域组件保持对终端域一无所知。
 */
export { default as ProjectTeamEntries } from './components/ProjectTeamEntries';
export { useActivateSession } from './hooks/useActivateSession';
export { useLiveSessionsBridge } from './hooks/useLiveSessionsBridge';
