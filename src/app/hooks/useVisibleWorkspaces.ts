import { useEffect, useRef } from 'react';

import { setVisibleWorkspaces } from '@/features/git/api/gitApi';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession, useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import { logFrontendError } from '@/shared/utils/errorReporting';
import { workspaceKeyLabel, type WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 集合签名（R1.4 的**唯一**去重判据）：WorkspaceKey 排序后 join。
 *
 * **不能**用对象 / 数组身份：`WorkspaceSession` 每次派生都是新对象，按身份去重等于永远「变了」
 * （`hook-guidelines.md` 常见错误 5 是同一形态的已踩事故）。排序让签名与集合顺序无关。
 */
function hotSetSignature(keys: readonly string[]): string {
  return [...keys].sort().join('\n');
}

/**
 * 一次声明的最佳努力落地：`ready` 写快照、`pending` 什么都不做、`failed` 只落一条 dev 日志。
 *
 * **没有重试、没有判死**（C4 / 红线 17）：`pending` 是冷窗口（挂载已成立、首快照在途），
 * 读路径（C1 起读永远给得出答案）与 `git-status-snapshot` 推送会收敛；`failed` 说明该单元
 * 自己不可观测（解析不了 / 不是 git 库 / pull 失败），重发同一条声明不会改变这个事实 ——
 * 「挂载可能不收敛」正是被删掉的那套补偿机制要解决的问题。
 *
 * 失败**不弹用户可见错误**：激活态仍指向该单元，面板按「未知」渲染（`未知 ≠ 干净`）；
 * 用户可见的错误面留给真正需要动作的失败（保存 / 命令）。
 *
 * 日志里的单元标签一律走 `workspaceKeyLabel` —— 键含 NUL 分隔符，直接插值会让日志文件
 * 被判成二进制。
 */
async function syncVisible(workspaces: WorkspaceSession[]): Promise<void> {
  let entries;
  try {
    entries = await setVisibleWorkspaces(workspaces);
  } catch (e) {
    // 整批命令失败（IPC / 运行时关停）：只落日志。下一轮视图变化会重新声明。
    await logFrontendError({
      source: 'visible-workspaces',
      message: `set_visible_workspaces failed for [${workspaces
        .map((w) => workspaceKeyLabel(w.key))
        .join(', ')}]: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }

  const { applyStatus } = useProjectStore.getState();
  for (const entry of entries) {
    if (entry.state === 'ready') {
      // version gate 在 applyStatus 内（同 key 单调），因此迟到的 ready 会被丢弃 ——
      // 这里不需要任何 staleness 守卫（那是「当前视图」的判据，不是「数据新旧」的判据）。
      applyStatus(entry.snapshot);
      continue;
    }
    if (entry.state === 'failed') {
      await logFrontendError({
        source: 'visible-workspaces',
        message: `workspace ${workspaceKeyLabel(entry.workspace_key)} is not observable: ${entry.error}`,
      });
    }
    // pending：不写槽位、不报错 —— 冷窗口由读路径与推送事件收敛。
  }
}

/**
 * 「当前视图是谁」→ 后端可见集合的**唯一写者**（声明式 reconcile）。
 *
 * 形态是 reconciliation，不是事件响应：收敛目标是「挂载集合 = 热集合」这一个状态，
 * 而不是「某次请求返回了什么」。因此本 hook **不持有任何「我请求过什么 / 后端挂了谁」的
 * 记账** —— 那是后端资源状态的影子副本（红线 17：前端若需要知道后端接管了谁，那是后端该
 * 提供的读接口）。
 *
 * **热集合的来源是内容可见性**（prd R1.2）：当前视图单元。停靠面板（Changes / Git Control …）
 * 都只渲染「当前单元」，所以当前实现下集合恒为 1 元素；多面板同时展示两个不同 Workspace 时
 * 才需要扩展派生点（形状已是集合，见 prd 开放问题）。
 *
 * **发送去重**：依赖数组里只有**字符串签名**，集合不变 ⇒ effect 不重跑 ⇒ 不发命令。
 *
 * 订阅 `(activeProjectId, 该项目激活的 worktree 路径)` 派生的身份（派生点在 `workspaceStore`
 * 一处）。用户动作（点 worktree / 切回主仓）只写激活态，挂载发起点因此只有这一个。
 *
 * 空签名（无项目 / 非 git 项目）= 热集合为空 ⇒ 声明 `[]`，后端据此释放全部挂载 ——
 * 「当前视图没有 git 内容」的声明就是空集合，这与「不发命令」不是一回事：不发命令会让上一个
 * 单元的 watcher 永远留着（无界累积）。
 */
export function useVisibleWorkspaces(): void {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const isGitProject = useProjectStore((s) => {
    if (!s.activeProjectId) return false;
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    // 清单尚未加载（undefined）与「明确非 git」（null）都归空集合：两者都不该有 push 生产者，
    // 而空集合是幂等声明（启动早期本来就没有挂载可释放）。
    return project ? project.git_info !== null : false;
  });
  const activeWorkspaceKey = useActiveWorkspaceKey(activeProjectId);
  const signature = isGitProject && activeWorkspaceKey ? hotSetSignature([activeWorkspaceKey]) : '';

  /** 声明串行链：上一条**落地**后才发下一条（顺序句柄，不是状态镜像 —— 它不记录后端挂了谁）。 */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** 最新一次声明的签名：轮到执行时不是最新就跳过（合并，避免快速切换时排队发一串旧声明）。 */
  const latestRef = useRef('');

  useEffect(() => {
    // ref 只在 effect 内写（渲染期写 ref 被 `react-hooks/refs` 拦下）。
    latestRef.current = signature;
    // 地址从 store 快照现取（唯一 mint = `activeWorkspaceSession`）：签名只负责「要不要重发」，
    // 不承担构造身份。这样即便 store 已走到下一次渲染之前，发出去的也是最新真值（幂等）。
    const projectId = useProjectStore.getState().activeProjectId;
    const hot = signature !== '' && projectId ? [activeWorkspaceSession(projectId)] : [];

    // **为什么必须串行**：每次 `invoke` 在 Tauri 里各自 spawn，后端在 reconcile 之前还要
    // `await` 地址解析与仓库校验（远端单元是 SSH/WSL 往返，几百 ms～秒级）。并发声明因此可以
    // 乱序落地 —— 一条**更早**的声明晚到，会以它的 `keep` 为准把刚挂上的单元释放掉，此后没有
    // 视图变化就不再收敛（重试环已删）。串行 + 「非最新即跳过」同时给出顺序与合并。
    chainRef.current = chainRef.current.then(() => {
      if (latestRef.current !== signature) return;
      return syncVisible(hot);
    });
  }, [signature]);
}
