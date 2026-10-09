import { useEffect, useRef, useState } from 'react';

import { useActivateWorkspace } from '@/features/git/hooks/useActivateWorkspace';
import { selectStatus, useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey, useActiveCheckoutPath } from '@/shared/store/workspaceStore';
import { logFrontendError } from '@/shared/utils/errorReporting';
import { createRetryBudget, type RetryPolicy } from '@/shared/utils/retryBudget';
import { workspaceKeyLabel } from '@/shared/utils/workspaceRef';

/**
 * 挂载收敛策略：当前单元还没拿到权威快照时，最多再试 3 次（退避 250 → 500 → 1000ms）。
 *
 * 有界是硬要求 —— 工作树真的没了的时候，「判死 + 回落主仓」**只**由 `useAppShellData` 的清单
 * 校验做（两处判死互抖是 2026-09-28 的既成事故）。重试只负责「再要一次快照」，绝不改激活意图，
 * 否则就是打后端的自激环。
 *
 * 墙钟上界不等于退避之和：每次尝试内部还有后端 1.5s 的有界等待（`RECALC_WAIT_TIMEOUT`），
 * 因此最坏约 8s 后停在「未知」。
 */
const ACTIVATION_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 1000 };

/**
 * 「当前视图是哪个Workspace」→ 后端挂载 的唯一同步点（决策 D-B 的落地点）。
 *
 * **形态是 reconciliation，不是事件响应**：收敛目标是「当前视图单元此刻有权威快照」这一个
 * 状态，而不是「某次请求返回了什么」。`mounted` / `stale` / `failed` 都只描述那一次请求，
 * 而失败与「槽位被别的写者作废」之后意图可以完全没变 —— 旧实现正是在这里失败：它按结局分支，
 * 而失败时只把一个 ref 置回 null，ref 不参与渲染 ⇒ 没有任何东西会再发起一次，界面永久停在
 * `Loading changes…`。
 *
 * **两个判据必须分开（这是本 hook 的正确性核心）**：
 *
 * 1. **要不要发挂载请求** —— 判据是**意图边沿**（`requestedIntent`）：意图变了就必须请后端
 *    接管这个单元。**不能**用「槽位非空」代替：`get_workspace_status` 的 pull 读（`useSessionBootstrap`
 *    启动时对每个 git 项目的主仓单元各拉一次）同样会写槽位，而 pull 不建立 push 生产者。
 *    把「槽位非空」当「已挂载」，冷启动竞态与「切到该项目」都会跳过挂载 ⇒ 该单元没有 watcher，
 *    列表冻结在那一刻（本 hook 要根治的症状形态）。后端资源状态才是唯一权威，前端的替代证据
 *    只能是「我自己的请求历史」。
 * 2. **要不要重试** —— 判据是**槽位为空**：有权威数据就收敛完成（归还预算），没有就有界重试。
 *
 * 订阅 `(activeProjectId, 该项目激活的 worktree 路径)` 派生的意图 —— 派生点在 `workspaceStore`
 * 一处（`useActiveWorkspaceKey`）。用户动作只写激活态（见 `useWorktreeState.activateWorktree`），
 * 因此挂载发起点仍然只有这一个。
 *
 * **所依赖的前提（改动前先读）**：`requestedIntent` 是前端对「后端已接管谁」的记账，它成立
 * 要求「后端释放当前单元」这件事在前端可观察 —— 现有的每条释放路径都满足：切项目
 * （`unwatch_project`）会改激活意图，`change_project_path` / 删除或改名 worktree 都会
 * `invalidateStatus` 该槽位。任一发生本 hook 都会重新请求挂载。若将来出现一条**静默释放**
 * （既不换意图也不作废槽位）的路径，正确做法是让后端可查询挂载状态，而不是在前端再加一条
 * 启发式 —— 那正是本文件要根治的错误形态。
 *
 * 记账是**实例级**的：整树重挂（HMR / StrictMode 重挂载）后它会归零，于是对已挂载单元会多发
 * 一次 `set_active_workspace`。后端 `mount_only` 幂等（不重建资源、不打重复注册告警），代价是
 * 一次 IPC —— 这是有意接受的下界，不是重复挂载。
 *
 * 非 git 项目（`git_info === null`）不发命令（`useActivateWorkspace` 内亦有同一守卫，
 * 因为项目切换与 git_info 落地之间可能先到这里）。
 */
export function useActiveWorkspaceSync(): void {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeCheckoutPath = useActiveCheckoutPath();
  const isGitProject = useProjectStore((s) => {
    if (!s.activeProjectId) return false;
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    // undefined（项目清单尚未加载）保守视为「先不动」；null = 明确非 git
    return project ? project.git_info !== null : false;
  });
  const activate = useActivateWorkspace(activeProjectId);

  /** 本轮要收敛的意图 = 当前视图单元的身份（与后端挂载、前端槽位同一把键）。 */
  const intent = useActiveWorkspaceKey(activeProjectId);
  const hasSnapshot = useProjectStore(
    (s) => intent !== null && selectStatus(s, intent) !== undefined,
  );

  // 预算按意图作用域：意图切换自动归零，因此不需要在切换时手工清理。
  const [budget] = useState(() => createRetryBudget(ACTIVATION_RETRY));
  /** 已请后端接管的意图（边沿跟踪）：挂载是「每个意图请求一次」的资源动作。 */
  const requestedIntent = useRef<string | null>(null);
  /** 请求在途的意图（并发去重）。 */
  const inflightIntent = useRef<string | null>(null);
  /** 已上报过「放弃」的意图：以一轮收敛为作用域，避免重跑 effect 时刷屏。 */
  const reportedGiveUp = useRef<string | null>(null);
  // 一轮尝试结束仍未落地 ⇒ 自增以重跑本 effect（重试的唯一驱动源；不轮询、不订阅定时器）。
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!activeProjectId || !isGitProject || intent === null) return;

    // 收敛完成：**有权威数据 且 后端已被要求接管**。两个条件缺一不可（见上方「两个判据」）。
    if (hasSnapshot && requestedIntent.current === intent) {
      // 归还预算 + 复位上报标记：同一意图下次被作废（槽位被别的写者清掉）时是新的一轮，
      // 既有完整次数，也应当重新上报一次「放弃」。
      budget.release(intent);
      reportedGiveUp.current = null;
      return;
    }
    if (inflightIntent.current === intent) return;

    // 预算天然承载两种触发：意图变化自动归零（首次立即执行），同一意图则按退避计数。
    const ticket = budget.acquire(intent);
    if (!ticket) {
      // 耗尽 ⇒ 保持「未知」，判死交给唯一判死点（`useAppShellData` 的清单校验）。
      // 只上报一次：这是「列表一直转」与「只是慢」在外部的唯一可分辨信号。
      if (reportedGiveUp.current !== intent) {
        reportedGiveUp.current = intent;
        void logFrontendError({
          source: 'workspace-sync',
          message:
            `no authoritative status for workspace ${workspaceKeyLabel(intent)} after ` +
            `${ACTIVATION_RETRY.maxAttempts} attempts; leaving it unknown`,
        });
      }
      return;
    }

    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      inflightIntent.current = intent;
      // 先记账再发请求：失败由下面的重试兜住，而「已请求过」这件事与成败无关 ——
      // 它决定的是「槽位非空时是否还需要请后端接管」，不是「数据到没到」。
      requestedIntent.current = intent;
      // `finally` 而非 `then`：一轮的结束与结局无关，收敛循环不能建立在「callee 永不 reject」
      // 这条只写在注释里的契约上（`useActivateWorkspace` 契约上失败即 outcome，不抛错）。
      // 万一契约被改坏，rejection 仍经全局 `unhandledrejection` 上报 neeko.log，不会被吞。
      void activate(activeCheckoutPath ?? null).finally(() => {
        if (inflightIntent.current === intent) inflightIntent.current = null;
        // 一轮结束仍未落地 ⇒ 推动下一轮（重试的唯一驱动源）
        if (selectStatus(useProjectStore.getState(), intent) === undefined) {
          setRetryTick((n) => n + 1);
        }
      });
    }, ticket.delayMs);
    // 定时器还没响就因依赖变化重跑（React StrictMode 的双挂载即如此）⇒ 退还这次尝试：
    // 预算计的是「发出去几次请求」，不是「effect 跑了几轮」。
    return () => {
      clearTimeout(timer);
      if (!fired) budget.release(intent);
    };
  }, [
    activeProjectId,
    activeCheckoutPath,
    isGitProject,
    activate,
    hasSnapshot,
    intent,
    budget,
    retryTick,
  ]);
}
