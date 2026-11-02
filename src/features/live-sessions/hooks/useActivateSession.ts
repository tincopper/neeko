import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { planSessionActivation } from '../utils/sessionActivationPlan';
import { recreateSessionTab } from '../utils/sessionTabFactory';

/**
 * 侧栏会话行 → 对应的 tab，找不到就**按会话重建**。
 *
 * 三级降级（判据见 `sessionActivationPlan`，落地见 `sessionTabFactory`）：
 *
 * 1. **映射键命中** ⇒ 激活。键是 `tab.data.ptySessionId`（terminal）/ `sessionId`（chat），
 *    由 PTY / agent_stream 创建成功后写入。
 * 2. **映射键丢了**（terminal 的写入被静默丢弃）⇒ 认领那条孤儿 tab，把 id 补回去再激活。
 *    这条降级是「点击没反应」的**存量修复**：不认领的话，那条 tab 永远点不开。
 * 3. **没有可用 tab** ⇒ 重建：会话**还活着**（关 tab 时选了「后台运行」）就接回那个 PTY；
 *    否则 terminal 优先**续写**（`live_session_resume_command` 的原生恢复参数拼
 *    `taskCommand`），拿不到就新建一个绑定同 agent 的终端；chat 新建一个空会话 tab。
 *
 * 本 hook 只做**编排**（判据 → 切视图 → 激活/补键/重建）；tab 怎么造在 factory，
 * 地址分量走 `WorkspaceSession.fromKeyOrId` 唯一 codec（红线 12：不在调用侧拆 key）。
 */
export function useActivateSession(): (session: SessionView) => void {
  return useCallback((session: SessionView) => {
    const editor = useEditorStore.getState();
    const tabs = editor.tabs[session.workspaceKey]?.tabs ?? [];
    const plan = planSessionActivation({ session, tabs });
    const workspace = WorkspaceSession.fromKeyOrId(session.workspaceKey);

    useWorkspaceStore.getState().setActiveWorkspace(workspace.projectId, workspace.worktreePath);

    if (plan.kind === 'activate') {
      editor.activateTab(session.workspaceKey, plan.tabId);
      return;
    }

    if (plan.kind === 'bind') {
      // 映射键补写：这条 tab 之后就能被正常命中（含「哪一行是前台」的派生）。
      editor.updateTab(session.workspaceKey, plan.tabId, { ptySessionId: session.sessionId });
      editor.activateTab(session.workspaceKey, plan.tabId);
      return;
    }

    // 重建要等后端解析原生恢复命令（一次 IPC），但点击本身已经生效（tab 稍后出现）——
    // 不必让事件处理等它。
    void recreateSessionTab(session, workspace);
  }, []);
}
