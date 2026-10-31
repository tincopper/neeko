/**
 * live-sessions 域的公开面（跨 feature 只允许经本文件导入）。
 *
 * 该域负责：把后端注册表快照接到前端（`useLiveSessionsBridge`），并装配侧栏会话子列表
 * （`UnitSessionList`）。状态 / 标题的**事实**在后端，本域不做任何推断。
 */

export { default as UnitSessionList } from './components/UnitSessionList';
export { useActivateSession } from './hooks/useActivateSession';
export { useLiveSessionsBridge } from './hooks/useLiveSessionsBridge';
