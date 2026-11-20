import { useCallback } from 'react';

import type { SelectProject } from '@/shared/contexts/ProjectActionsContext';
import { useEditorStore } from '@/shared/store/editorStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { activateUnit } from '../utils/activateUnit';
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
 * 本 hook 只做**编排**（判据 → 切单元/项目 → 激活/补键/重建）；tab 怎么造在 factory，
 * 地址分量走 `WorkspaceSession.fromKeyOrId` 唯一 codec（红线 12：不在调用侧拆 key）。
 *
 * **「切单元」= `activateUnit`**（连同该行所属**项目**，见 `utils/activateUnit`）：侧栏列出所有
 * 项目的会话，只切单元不切项目就会出现「tab 在 B 的 tab 空间里被激活、中心视图还停在 A」——
 * 用户说的「点了没反应」。
 *
 * 顺序：**单元落回之后**才激活 tab（`activateUnit` 的 Promise 结算点就是「项目与单元都已是
 * 当前」）。反过来会在切换序列还没结算时先切 tab，而序列内部会清空各项目单元。
 *
 * # 为什么切项目的能力是**入参**，不是 `useProjectActionsContext()`
 *
 * 本 hook 还有一个**组合根**调用点：`useDockBarOpenTab` 在 `App.tsx` 里装配（Provider 树的
 * **外面** —— 见 `state-management.md`「组合根在 Provider 之外」那条事故）。在那里任何
 * `useContext` 都会在首帧抛错（整棵应用进 ErrorBoundary）。所以能力由调用侧注入：
 * - 侧栏（树内）：`useActivateUnit()` 或 context 里的 `onSelectProject`；
 * - 组合根（树外）：`useAppShell()` 返回值里的 `projectActionsValue.onSelectProject`。
 *
 * 入参**必填、无默认值**：静默降级成「只切单元」正是本任务要修的缺陷形态。
 */
export function useActivateSession(selectProject: SelectProject): (session: SessionView) => void {
  return useCallback(
    (session: SessionView) => {
      const tabs = useEditorStore.getState().tabs[session.workspaceKey]?.tabs ?? [];
      const plan = planSessionActivation({ session, tabs });
      const workspace = WorkspaceSession.fromKeyOrId(session.workspaceKey);

      void activateUnit({ selectProject }, workspace.projectId, workspace.worktreePath).then(() => {
        // 跨项目时切换序列是异步的 ⇒ 动作必须在结算后**重新取**，不用切换前的快照。
        const editor = useEditorStore.getState();

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

        // 重建要等后端解析原生恢复命令（一次 IPC），但点击本身已经生效（tab 稍后出现）。
        void recreateSessionTab(session, workspace);
      });
    },
    [selectProject],
  );
}
