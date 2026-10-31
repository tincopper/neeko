import { useCallback } from 'react';

import { sessionTab } from '@/shared/selectors/liveSessionSelectors';
import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 侧栏会话行 → 对应的 tab。
 *
 * 两步都是**纯投影**：`sessionTab` 用会话 id 命中 tab（chat 用 `data.sessionId`，
 * terminal 用 `data.ptySessionId`），地址分量由 `WorkspaceSession.fromKeyOrId` 唯一 codec 取
 * （红线 12：不在调用侧拆 key 字符串）。
 *
 * tab 不存在（已被关闭）时**什么都不做**：切到那个单元会把人带到一个空视图，
 * 而注册表里的会话可能只是关 tab 前的最后一帧。宁可不响应，不做假动作。
 */
export function useActivateSession(): (session: SessionView) => void {
  return useCallback((session) => {
    const tabs = useEditorStore.getState().tabs[session.workspaceKey]?.tabs ?? [];
    const tab = sessionTab(session, tabs);
    if (!tab) return;

    const { projectId, worktreePath } = WorkspaceSession.fromKeyOrId(session.workspaceKey);
    useWorkspaceStore.getState().setActiveWorkspace(projectId, worktreePath);
    useEditorStore.getState().activateTab(session.workspaceKey, tab.id);
  }, []);
}
