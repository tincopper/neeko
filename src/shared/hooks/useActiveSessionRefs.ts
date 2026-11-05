import { useMemo } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveSessionRefs } from '@/shared/store/editorTabSelectors';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import type { SessionRef } from '@/shared/types/liveSessions';

/** 无当前单元（或当前单元没有前台会话）时的共享空结果：重渲染不换引用，行组件 memo 才有效。 */
const NO_ACTIVE_SESSION_REFS: readonly SessionRef[] = [];

/**
 * 「当前前台会话」的**全局唯一派生点**（R8）。
 *
 * `editorStore.editorLayout[tabKey].activeTabId` 是按单元分槽的**局部**事实（切回该单元要
 * 恢复上次前台 tab）。把局部状态直接当「当前」会让切项目 / 切 worktree 之后的旧单元继续
 * 亮着；区分两者的唯一派生点是 `useActiveWorkspaceKey(activeProjectId)`（激活态单源），
 * 热集合恒为 1 个元素（见 `useVisibleWorkspaces`）。
 *
 * 父行让出选中底（`useUnitsWithActiveSession`）与子行 `row-current`（`UnitSessionList`）
 * 都必须消费**这一份** refs，禁止各自再判一次 `workspaceKey === activeKey` —— 那会造出
 * 第二份「当前」判据（R8.2 / 红线 17：不建影子状态）。
 *
 * `tabs` / `editorLayout` 是稳定切片，只在它们或激活单元真的变化时重算；不要把会新建
 * 数组的 selector 直接交给 `useEditorStore`（每次 getSnapshot 都会触发 `Object.is` 失配）。
 */
export function useActiveSessionRefs(): readonly SessionRef[] {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorkspaceKey = useActiveWorkspaceKey(activeProjectId);
  const tabs = useEditorStore((s) => s.tabs);
  const editorLayout = useEditorStore((s) => s.editorLayout);

  return useMemo(() => {
    if (!activeWorkspaceKey) return NO_ACTIVE_SESSION_REFS;
    const refs = selectActiveSessionRefs({ tabs, editorLayout }, activeWorkspaceKey);
    return refs.length > 0 ? refs : NO_ACTIVE_SESSION_REFS;
  }, [activeWorkspaceKey, tabs, editorLayout]);
}
