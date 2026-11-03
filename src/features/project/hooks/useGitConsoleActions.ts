import { useCallback } from 'react';

import { pull, push } from '@/features/git/api/gitApi';
import {
  GIT_BUSY_MESSAGE,
  authRequiredMessage,
  isAuthRequired,
  runGitConsoleOp,
} from '@/features/git/api/gitConsoleRun';
import type { Project, PushOutcome } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/** 侧栏能发起的远程 git 操作。新增一种 = 下面的表加一行，不改任何分支。 */
export type RemoteGitOp = 'push' | 'pull';

/**
 * 「发哪个命令」的唯一差异点，其余（路径解析 / Console 编排 / busy / 取消 / 认证 / 刷新）
 * 三个入口完全一致。
 *
 * 为什么用表而不是 `if (kind === 'push')`：开关语句只能靠人保证两个分支一起改；表把差异
 * 压缩成一行，加 `fetch` 就是加一行。
 */
const REMOTE_GIT_OPS: Record<
  RemoteGitOp,
  (session: WorkspaceSession, runId: string) => Promise<PushOutcome>
> = {
  push: (session, runId) => push(session, false, runId),
  pull: (session, runId) => pull(session, runId),
};

/**
 * AuthRequired → 侧栏可读的提示；成功 ⇒ `undefined`。
 *
 * 侧栏没有凭据对话（那是 Git 面板的事），所以两种认证情形都翻成一句话，并指向能真正
 * 解决它的入口。事实部分（SSH 分支 / URL / 用户名）与提交对话框共用 `authRequiredMessage`。
 */
const AUTH_FIX_HINT = 'Use the main commit panel or configure git credentials.';

interface UseGitConsoleActionsParams {
  projects: Project[];
  /** 当前激活项目（决定 `activeCheckoutPath` 属于哪个单元）。 */
  activeProjectId: ProjectId | null;
  /** 激活项目当前的 checkout 路径；linked worktree 时非 null。 */
  activeCheckoutPath: string | null;
  onRefreshGit: (projectId: ProjectId) => void;
  showToast?: (message: string, type?: 'info' | 'error') => void;
}

export interface GitConsoleActions {
  handlePush: (projectId: ProjectId) => void;
  handlePull: (projectId: ProjectId) => void;
}

/**
 * 侧栏项目卡的 push / pull —— **一条编排，两个入口**。
 *
 * 原本是两个逐行相同的 handler（只有 header 与命令不同），复制一份的代价是必然漂移：
 * 某天只给 push 加了刷新、或只给 pull 改了 busy 文案，用户看到的就是「同一个仓库两种行为」。
 *
 * Console 生命周期（打开/复用 tab → ok | stopped | busy 收尾）仍然由唯一实现
 * `runGitConsoleOp` 负责（`features/git/api/gitConsoleRun.ts`），本 hook 只做侧栏这一层的
 * 决策：解析仓库路径 → 跑命令 → 把结果翻成 toast / 刷新。
 */
export function useGitConsoleActions({
  projects,
  activeProjectId,
  activeCheckoutPath,
  onRefreshGit,
  showToast,
}: UseGitConsoleActionsParams): GitConsoleActions {
  const runRemoteOp = useCallback(
    async (kind: RemoteGitOp, projectId: ProjectId): Promise<void> => {
      const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
      // worktree 只对**激活项目**生效：别的项目的 checkout 路径属于别的单元，带错会把命令
      // 发到错误的仓库（后端按 session 解析 cwd）。
      const worktreePath = activeProjectId === projectId ? activeCheckoutPath : null;
      const session = WorkspaceSession.of(projectId, worktreePath);

      try {
        const result = await runGitConsoleOp({
          header: `git ${kind}`,
          projectId,
          projectPath,
          run: (runId) => REMOTE_GIT_OPS[kind](session, runId),
          isAuthRequired,
        });
        if (result.status === 'busy') {
          showToast?.(GIT_BUSY_MESSAGE, 'error');
          return;
        }
        if (result.status === 'stopped') return; // 用户取消：静默
        const authMessage = authRequiredMessage(result.value, AUTH_FIX_HINT);
        if (authMessage) {
          // 认证失败由用户去 Git 面板处理，此处不刷新（没有发生任何变更）。
          showToast?.(authMessage, 'error');
          return;
        }
        onRefreshGit(projectId);
      } catch (e) {
        showToast?.(String(e), 'error');
      }
    },
    [projects, activeProjectId, activeCheckoutPath, onRefreshGit, showToast],
  );

  return {
    handlePush: useCallback(
      (projectId: ProjectId) => void runRemoteOp('push', projectId),
      [runRemoteOp],
    ),
    handlePull: useCallback(
      (projectId: ProjectId) => void runRemoteOp('pull', projectId),
      [runRemoteOp],
    ),
  };
}
