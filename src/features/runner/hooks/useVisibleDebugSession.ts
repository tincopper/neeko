import { useProjectStore } from '@/shared/store/projectStore';

import { isSessionVisibleFor } from '../sessionVisibility';
import { useDebugStore } from '../store/debugStore';
import type { DapSessionInfo } from '../types';

/**
 * 当前项目可见的调试会话：仅当 session 属于 activeProject 时返回，否则 null。
 *
 * 门控本身只有一处实现（`isSessionVisibleFor`）—— 见该模块的「为什么单独成模块」。
 *
 * `useDebugStore` 是全局单会话（`DapSessionInfo.projectId` 携带所属项目）。切换项目后，
 * 旧项目的会话仍留在 store 中（其 DAP 事件继续流入、更新 session/console/栈/停点），
 * 若 UI 直接读全局 session，会出现「选 A 项目却显示 B 项目的输出」。本 hook 按
 * `activeProjectId` 屏蔽跨项目会话；会话不销毁，切回原项目即恢复。
 */
export function useVisibleDebugSession(): DapSessionInfo | null {
  const session = useDebugStore((s) => s.session);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  return isSessionVisibleFor(session, activeProjectId) ? session : null;
}
