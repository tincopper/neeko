import { useCallback } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceKeyOf, useWorkspaceStore } from '@/shared/store/workspaceStore';
import { workspaceKeyLabel, workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { activateWorkspace } from '../api/gitApi';

/** 挂载结果，供唯一发起点决定下一步（不要把语义藏在 resolve(void) 里）。 */
export type ActivateOutcome = 'mounted' | 'stale' | 'skipped' | 'failed';

/**
 * 请后端把某Workspace挂为「当前单元」并取回首个快照（决策 D-B：后端只挂当前视图所在的那一个单元）。
 *
 * **只由 `useActiveWorkspaceSync`（composition 层）调用** —— 用户动作（点 worktree、
 * 切回主仓）只写激活态，不直接发命令。理由：挂载/释放必须与「当前视图」严格一致，
 * 有两个发起点就有时序差（旧实现正是散落在 effect、事件回调、刷新按钮里各自取全局镜像）。
 *
 * **路径归一在这里回传**：后端是路径身份的唯一归一点（红线 8/12），它回传的
 * `snapshot.worktree_path` 才是 canonical 形态。入参可能来自旧 session 文件（本次之前没人
 * 保证归一，如 macOS 的 `/tmp` ↔ `/private/tmp`），因此挂载成功后把激活态改写成后端形态 ——
 * 前端自己猜归一必然与后端漂移，而「激活态与槽位 key 不同形」正是 worktree 视图串数据的根。
 *
 * 失败语义：该单元置为「未知」（槽位缺失），调用方渲染空态/加载态 —— 绝不沿用上一个
 * 单元的数据。非 git 项目（`git_info === null`）不发任何 git 命令。
 *
 * **一次失败不是事故**：调用方（唯一发起点）会按有界预算重试，并在放弃时上报一次。因此这里
 * 只落一条 dev 侧诊断（带错误对象），不弹提示、不升级为用户可见错误 —— 首个快照未落地是冷启动
 * 的正常窗口。日志里的单元身份走 `workspaceKeyLabel`：`String(workspaceKey)` 会把分隔符 NUL 带进日志，
 * 让日志文件被判成二进制（实测过）。
 */
export function useActivateWorkspace(
  projectId: string | null,
): (path: string | null) => Promise<ActivateOutcome> {
  return useCallback(
    async (path: string | null) => {
      if (!projectId) return 'skipped';
      const store = useProjectStore.getState();
      const project = store.projects.find((p) => p.id === projectId);
      if (!project || project.git_info === null) return 'skipped';
      const key = workspaceKeyOf(projectId, path);
      try {
        const snapshot = await activateWorkspace(projectId, path);
        // 快照自带 workspace_key；只接受仍然指向当前视图的结果（切换竞态下丢弃迟到响应）
        const latest = activeWorkspaceKeyOf(projectId);
        if (latest !== key && snapshot.workspace_key !== latest) return 'stale';
        store.applyStatus(snapshot);
        const canonical = snapshot.worktree_path ?? null;
        if (canonical !== (path ?? null)) {
          useWorkspaceStore
            .getState()
            .setActiveWorkspace(projectId, canonical, snapshot.branch || undefined);
        }
        return 'mounted';
      } catch (e) {
        store.invalidateStatus(key);
        console.error(
          '[useActivateWorkspace] activate workspace failed for',
          workspaceKeyLabel(key),
          e,
        );
        return 'failed';
      }
    },
    [projectId],
  );
}
