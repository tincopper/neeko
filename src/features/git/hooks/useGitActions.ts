import { useCallback, useState } from 'react';

import type { CommitResult, PushOutcome } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';
import { withTimeout } from '@/shared/utils/withTimeout';

import { formatGitHost } from '../formatGitHost';

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
}

/**
 * GitCommitPanel 的 git 操作域：fetch/pull/push/commit/stage/discard 系列
 * 命令编排（含超时包装、凭据对话状态、AuthRequired 分流、toast 反馈）。
 * 纯命令编排层——不含 UI 状态（选中文件、对话框 JSX 由宿主持有）。
 */
export function useGitActions({
  commands,
  onRefreshGit,
  onShowToast,
  onCommitMessageClear,
  selectedFiles,
  onSelectedFilesClear,
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

  const handleDiscardFile = useCallback(
    (path: string) => {
      setLoading(true);
      withTimeout(commands.discardFile(path), TIMEOUT_LOCAL_MS, 'discard')
        .then(async () => {
          await onRefreshGit();
          onShowToast?.('Discarded changes', 'info');
        })
        .catch((e: unknown) => onShowToast?.(String(e), 'error'))
        .finally(() => setLoading(false));
    },
    [commands, onRefreshGit, onShowToast],
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

  /** Discard 确认弹窗的实际执行（file / all 两分支），由宿主的确认流调用。 */
  const handleConfirmDiscard = useCallback(
    async (confirm: { type: 'file'; path: string } | { type: 'all'; count: number }) => {
      setLoading(true);
      try {
        if (confirm.type === 'file') {
          await withTimeout(commands.discardFile(confirm.path), TIMEOUT_LOCAL_MS, 'discard');
        } else {
          await withTimeout(commands.discardAll(), TIMEOUT_LOCAL_MS, 'discard-all');
        }
        await onRefreshGit();
        if (confirm.type === 'all') {
          onSelectedFilesClear();
        }
        onShowToast?.(
          confirm.type === 'all' ? 'Discarded all changes' : 'Discarded changes',
          'info',
        );
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [commands, onRefreshGit, onShowToast, onSelectedFilesClear],
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
    handleDiscardFile,
    handleConfirmDiscard,
    handleStageAllUntracked,
    handleFetch,
    handlePull,
    handlePush,
    handleStageFile,
    handleCommit,
    handleCommitAndPush,
  };
}
