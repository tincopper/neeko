import { useCallback, useState } from 'react';

import type { CommitResult, FileChange, PushOutcome } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';
import { withTimeout } from '@/shared/utils/withTimeout';

import { formatGitHost } from '../formatGitHost';
import type { DiscardIntent } from '../utils/discardIntent';
import { isConflictedEntry } from '../utils/gitStatusGroups';

/** 本地 git 操作超时（discard/stage/commit）。 */
const TIMEOUT_LOCAL_MS = 30_000;
/** 网络 git 操作超时（fetch/pull/push）。 */
const TIMEOUT_NETWORK_MS = 120_000;

export interface CredentialDialogState {
  open: boolean;
  host: string;
  usernameHint: string | null;
  setUpstream: boolean;
}

const CREDENTIAL_DIALOG_CLOSED: CredentialDialogState = {
  open: false,
  host: '',
  usernameHint: null,
  setUpstream: false,
};

/**
 * 选中文件是否含未解决冲突（commit/commit-and-push 前的提交拦截）。
 * porcelain 未合并组合判定见 isConflictedEntry；冲突文件被 git add 会清除
 * unmerged 标记，直接提交会把未解决冲突当作已解决，故必须在命令层阻止。
 */
export function hasConflictedSelected(
  changedFiles: FileChange[],
  selectedFiles: ReadonlySet<string>,
): boolean {
  return changedFiles.some((f) => selectedFiles.has(f.path) && isConflictedEntry(f));
}

interface UseGitActionsParams {
  commands: ProjectCommands;
  onRefreshGit: () => Promise<void>;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 提交成功后清空 commit message（commit message 状态归 CommitForm 侧持有） */
  onCommitMessageClear: () => void;
  /** 当前选中的文件（commit 系列操作使用）。 */
  selectedFiles: ReadonlySet<string>;
  /** selectedFiles 变更（commit 成功后清空选择）。 */
  onSelectedFilesClear: () => void;
  /**
   * 只移除指定路径的选中态（discard 成功后）。
   *
   * 丢弃是**局部**操作：丢掉 2 个不应连带清掉另外 3 个的勾选
   * （`onSelectedFilesClear` 是 commit 那种「整批已消费」语义，不适用于此）。
   */
  onSelectedFilesRemove: (paths: readonly string[]) => void;
  /** 当前文件变更快照（含 porcelain XY；提交前冲突校验用，见 hasConflictedSelected）。 */
  changedFiles: FileChange[];
}

/**
 * GitCommitPanel 的 git 操作域：fetch/pull/push/commit/stage/discard/checkout
 * 系列、untracked 目录展开的命令编排（含超时包装、凭据对话状态、AuthRequired
 * 分流、toast 反馈）。纯命令编排层——不含 UI 状态（选中文件、对话框 JSX 由宿主持有）。
 */
export function useGitActions({
  commands,
  onRefreshGit,
  onShowToast,
  onCommitMessageClear,
  selectedFiles,
  onSelectedFilesClear,
  onSelectedFilesRemove,
  changedFiles,
}: UseGitActionsParams) {
  const [loading, setLoading] = useState(false);
  const [credentialDialog, setCredentialDialog] =
    useState<CredentialDialogState>(CREDENTIAL_DIALOG_CLOSED);

  /** Handle the result of push/pull/fetch. Returns true if caller should stop further processing. */
  const handlePushOutcome = useCallback(
    (outcome: PushOutcome, _opName: string, setUpstream = false): boolean => {
      if ('AuthRequired' in outcome) {
        const { remote_url, ssh, username_hint } = outcome.AuthRequired;
        if (ssh) {
          onShowToast?.(
            'SSH authentication failed. Ensure ssh-agent is running and key is added via ssh-add.',
            'error',
          );
        } else {
          setCredentialDialog({
            open: true,
            host: formatGitHost(remote_url),
            usernameHint: username_hint,
            setUpstream,
          });
        }
        return true; // caller should stop / not treat as success
      }
      return false; // Success
    },
    [onShowToast],
  );

  const handleCredentialSubmit = useCallback(
    async (username: string, password: string) => {
      const setUpstream = credentialDialog.setUpstream;
      setCredentialDialog((prev) => ({ ...prev, open: false }));
      setLoading(true);
      try {
        const outcome = await withTimeout(
          commands.pushWithCredentials(setUpstream, username, password),
          TIMEOUT_NETWORK_MS,
          'push',
        );
        if (!handlePushOutcome(outcome, 'push', setUpstream)) {
          await onRefreshGit();
          onSelectedFilesClear();
          onCommitMessageClear();
          onShowToast?.('Pushed successfully', 'info');
        }
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [
      commands,
      onRefreshGit,
      onShowToast,
      handlePushOutcome,
      credentialDialog.setUpstream,
      onSelectedFilesClear,
      onCommitMessageClear,
    ],
  );

  const runNetworkOp = useCallback(
    async (
      opName: string,
      op: () => Promise<PushOutcome>,
      successMessage: string,
    ): Promise<void> => {
      setLoading(true);
      try {
        const outcome: PushOutcome = await withTimeout(op(), TIMEOUT_NETWORK_MS, opName);
        if (handlePushOutcome(outcome, opName)) return;
        await onRefreshGit();
        onShowToast?.(successMessage, 'info');
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [handlePushOutcome, onRefreshGit, onShowToast],
  );

  const handleFetch = useCallback(
    () => runNetworkOp('fetch', () => commands.fetch(), 'Fetched successfully'),
    [commands, runNetworkOp],
  );

  const handlePull = useCallback(
    () => runNetworkOp('pull', () => commands.pull(), 'Pulled successfully'),
    [commands, runNetworkOp],
  );

  const handlePush = useCallback(
    () => runNetworkOp('push', () => commands.push(false), 'Pushed successfully'),
    [commands, runNetworkOp],
  );

  const handleCheckoutBranch = useCallback(
    async (branchName: string) => {
      try {
        await commands.checkoutBranch(branchName);
        await onRefreshGit();
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      }
    },
    [commands, onRefreshGit, onShowToast],
  );

  // 展开折叠的 untracked 目录条目：按需拉取目录下的 untracked 文件列表。
  // 失败必须**抛出**而不是返回 `[]`：把失败伪装成「空目录」会让展开 hook 把空列表
  // 当作有效结果（目录里的文件全部消失），且无从重试。抛出后由 hook 记为失败并
  // 保持目录占位，下一次失效信号（刷新/目录内容变化）再重试。
  const handleExpandUntrackedDir = useCallback(
    async (dirPath: string) => {
      try {
        return await commands.listUntrackedFiles(dirPath);
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
        throw e;
      }
    },
    [commands, onShowToast],
  );

  const handleStageFile = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        await withTimeout(commands.stageFiles([path]), TIMEOUT_LOCAL_MS, 'stage');
        await onRefreshGit();
        onShowToast?.('Staged file', 'info');
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [commands, onRefreshGit, onShowToast],
  );

  /**
   * Discard 确认弹窗的实际执行，由宿主的确认流调用。
   *
   * 只消费 `intent.paths`：执行范围严格等于用户确认过的那份集合，后端不再
   * 自行扩大（后端同样按传入路径分类分派，不整仓扫描）。
   */
  const handleConfirmDiscard = useCallback(
    async (intent: DiscardIntent) => {
      if (intent.paths.length === 0) return;
      setLoading(true);
      let failure: unknown = null;
      try {
        try {
          await withTimeout(commands.discardFiles(intent.paths), TIMEOUT_LOCAL_MS, 'discard');
          // 先摘掉已丢弃路径的勾选，再刷新：中间态不会出现「勾选项已不存在」。
          onSelectedFilesRemove(intent.paths);
        } catch (e: unknown) {
          failure = e;
        }
        // 刷新**无条件执行**（成败都要）。discard 由多条 git 子命令串联而成、
        // 非原子：任一条中途失败都可能已部分生效（如 clean 跳过含嵌套仓库的目录、
        // checkout 对某一 pathspec 失败）。此时列表若留在旧快照上，用户无法判断
        // 实际发生了什么 —— 必须回到仓库真实状态。
        try {
          await onRefreshGit();
        } catch (e: unknown) {
          failure ??= e;
        }
      } finally {
        setLoading(false);
      }

      if (failure === null) {
        const count = intent.paths.length;
        onShowToast?.(`Discarded ${count} file${count === 1 ? '' : 's'}`, 'info');
      } else {
        onShowToast?.(String(failure), 'error');
      }
    },
    [commands, onRefreshGit, onShowToast, onSelectedFilesRemove],
  );

  /** Stage 全部 untracked 文件。 */
  const handleStageAllUntracked = useCallback(
    async (untrackedPaths: string[]) => {
      if (untrackedPaths.length === 0) return;
      setLoading(true);
      try {
        await withTimeout(commands.stageFiles(untrackedPaths), TIMEOUT_LOCAL_MS, 'stage-all');
        await onRefreshGit();
        onShowToast?.(`Staged ${untrackedPaths.length} file(s)`, 'info');
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [commands, onRefreshGit, onShowToast],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      const files = Array.from(selectedFiles);
      if (files.length === 0) {
        onShowToast?.('No files selected. Check files to commit.', 'error');
        return;
      }
      // W1 根治：未解决冲突文件被选中时阻止提交（git add 会清除 unmerged 标记，
      // 直接提交会把未解决冲突当作已解决）。
      if (hasConflictedSelected(changedFiles, selectedFiles)) {
        onShowToast?.(
          'Cannot commit: unresolved merge conflict selected. Resolve conflicts or uncheck conflicted files first.',
          'error',
        );
        return;
      }
      setLoading(true);
      try {
        const result = (await withTimeout(
          commands.commitFiles(files, message),
          TIMEOUT_LOCAL_MS,
          'commit',
        )) as CommitResult;
        await onRefreshGit();
        onSelectedFilesClear();
        onCommitMessageClear();
        onShowToast?.(
          `Committed ${result.hash ? result.hash.slice(0, 7) : 'successfully'}`,
          'info',
        );
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [
      selectedFiles,
      changedFiles,
      commands,
      onRefreshGit,
      onShowToast,
      onSelectedFilesClear,
      onCommitMessageClear,
    ],
  );

  const handleCommitAndPush = useCallback(
    async (message: string) => {
      const files = Array.from(selectedFiles);
      if (files.length === 0) {
        onShowToast?.('No files selected. Check files to commit.', 'error');
        return;
      }
      // W1 根治：同 handleCommit，commit-and-push 同样阻止冲突文件提交。
      if (hasConflictedSelected(changedFiles, selectedFiles)) {
        onShowToast?.(
          'Cannot commit: unresolved merge conflict selected. Resolve conflicts or uncheck conflicted files first.',
          'error',
        );
        return;
      }
      setLoading(true);
      try {
        await withTimeout(commands.commitFiles(files, message), TIMEOUT_LOCAL_MS, 'commit');
        const outcome: PushOutcome = await withTimeout(
          commands.push(false),
          TIMEOUT_NETWORK_MS,
          'push',
        );
        if (handlePushOutcome(outcome, 'push')) return; // AuthRequired handled
        await onRefreshGit();
        onSelectedFilesClear();
        onCommitMessageClear();
        onShowToast?.('Committed & pushed successfully', 'info');
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [
      selectedFiles,
      changedFiles,
      commands,
      onRefreshGit,
      onShowToast,
      handlePushOutcome,
      onSelectedFilesClear,
      onCommitMessageClear,
    ],
  );

  return {
    loading,
    setLoading,
    credentialDialog,
    setCredentialDialog,
    handleCredentialSubmit,
    handlePushOutcome,
    handleConfirmDiscard,
    handleStageAllUntracked,
    handleFetch,
    handlePull,
    handlePush,
    handleStageFile,
    handleCheckoutBranch,
    handleExpandUntrackedDir,
    handleCommit,
    handleCommitAndPush,
  };
}
