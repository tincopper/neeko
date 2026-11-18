import type { SelectProject } from '@/shared/contexts/ProjectActionsContext';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 「点侧栏里属于某个单元的东西」的**唯一判据**：那个单元（连同它的**项目**）成为当前。
 *
 * # 为什么需要一个函数，而不是两处各写一半
 *
 * 侧栏列出**所有**项目的单元与会话，而点击只激活单元时不切项目：tab 在 B 的 tab 空间里
 * 被激活、单元状态也切了，中心视图仍停在项目 A —— 表现就是用户说的「点了没反应」。
 * 这条规则原先没有名字，于是两个消费者（`useActivateSession` 的会话行、
 * `useTeamEntryActions` 的团队行三个动作）各写了一半。现在它是本函数。
 *
 * # 两条硬约束
 *
 * 1. **已激活的项目不切**。切项目的那条序列（`ProjectActionsContext.onSelectProject` →
 *    `useCrossTypeSelection.handleSelectProject`）会**清掉所有项目的激活单元**，
 *    local 分支还会再清一次目标项目并回到主仓。对一个已经激活的项目重跑它是纯破坏：
 *    把用户刚点的工作树单元清回主仓，外加一次多余的 `set_active_project` IPC。
 * 2. **单元必须在切换序列结算之后落回**。序列内部「先清空各项目单元、再按类型落位」，
 *    在它之前设单元等于自己把自己擦掉。`onSelectProject` 是 `async`（类型上放宽为
 *    `void | Promise<void>`），所以调用侧必须 `Promise.resolve(...)` 后接续，
 *    **不依赖「它今天恰好是同步的」**—— 今天整段同步跑完只是巧合，任何一天有人在中间
 *    插一个真正的 `await`，退化后的症状只是「点了没落到那个工作树」，没人会想到这里。
 *
 * 纯编排（两个 store + 一个注入的切换函数），无 React —— 顺序是本设计唯一承重的不变量，
 * 因此它必须能被直接单测（见 `__tests__/activateUnit.test.ts` 的顺序断言）。
 *
 * 单元身份经 `WorkspaceSession.of(...)` 铸（红线 12）：调用侧既不拼 key 也不拆路径。
 */
export interface ActivateUnitDeps {
  /** 切项目的**唯一序列** —— 只允许是 `ProjectActionsContext.onSelectProject`。 */
  selectProject: SelectProject;
}

export function activateUnit(
  deps: ActivateUnitDeps,
  projectId: ProjectId,
  worktreePath: string | null,
): Promise<void> {
  const unit = WorkspaceSession.of(projectId, worktreePath);
  const setUnit = () => {
    useWorkspaceStore.getState().setActiveWorkspace(unit.projectId, unit.worktreePath);
  };

  // 判据读 store 的**当前**值（不是渲染期快照）：调用点是事件回调。
  if (useProjectStore.getState().activeProjectId === unit.projectId) {
    // 同项目 ⇒ 零切换（R3），同步落单元 ⇒ 同项目点击的结果与改造前逐字一致。
    setUnit();
    return Promise.resolve();
  }

  return Promise.resolve(deps.selectProject(unit.projectId)).then(setUnit);
}
