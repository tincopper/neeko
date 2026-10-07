import React, { useState, useCallback, useMemo } from 'react';

import { openProjectFile } from '@/features/quick-open';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore, selectStatus } from '@/shared/store/projectStore';
import type { AheadBehind } from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';
import type { RepoKey } from '@/shared/utils/repoRef';

import {
  useAiCommitMessage,
  useCommitPanelDiffStats,
  useDividerDrag,
} from '../hooks/useCommitPanelAux';
import { useDiscardConfirm } from '../hooks/useDiscardConfirm';
import { useFileSelection } from '../hooks/useFileSelection';
import { useGitActions } from '../hooks/useGitActions';
import { useGitDialogRequest } from '../hooks/useGitDialogRequest';

import BranchInfo from './BranchInfo';
import ChangesList from './ChangesList';
import CommitForm from './CommitForm';
import CommitPanelDivider from './CommitPanelDivider';
import DiscardConfirmDialog from './DiscardConfirmDialog';
import GitCredentialDialog from './GitCredentialDialog';
import GitDialog from './GitDialog';

interface GitCommitPanelProps {
  project: ProjectView;
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  onRefreshGit: () => Promise<void>;
  onSelectFile?: (filePath: string) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenDialog?: (type: 'new-branch' | 'new-worktree', e: React.MouseEvent) => void;
  aheadBehind: AheadBehind | null;
  /** 本面板当前渲染的仓库单元（主仓或某 worktree）；status 按它定址读取。 */
  repoKey: RepoKey;
}

const GitCommitPanel: React.FC<GitCommitPanelProps> = ({
  project,
  commands,
  capabilities,
  onRefreshGit,
  onSelectFile,
  onShowToast,
  onOpenDialog,
  aheadBehind,
  repoKey,
}) => {
  const [commitMessage, setCommitMessage] = useState('');

  // G4（P3）：快照截断状态（按单元存，主仓与 worktree 互不相关）
  const statusTruncated = useGitStore((s) => s.truncatedByRepo[repoKey] ?? false);

  // 唯一权威源：projectStore.statuses[repoKey]（后端按单元推送/计算，version gate 在 store 内）。
  // `undefined` = 该单元状态未知（未挂载 / 首个快照未到）→ 渲染空态，绝不沿用别处的数据。
  const status = useProjectStore((s) => selectStatus(s, repoKey));
  const changedFiles = useMemo(() => status?.entries ?? [], [status]);

  const noCommits =
    project.gitInfo !== null &&
    project.gitInfo.branches.length === 0 &&
    !project.gitInfo.current_branch;

  // ── 选中域：勾选 / discard 局部摘除 / commit 整批清空，见 useFileSelection ──
  const { selectedFiles, toggleFile, removeSelected, clearSelected } = useFileSelection();

  // ── Git 操作域（fetch/pull/push/commit/stage/discard/checkout），见 useGitActions ──
  const {
    loading,
    setLoading,
    credentialDialog,
    setCredentialDialog,
    handleCredentialSubmit,
    handleFetch,
    handlePull,
    handlePush,
    handleStageFile,
    handleStageAllUntracked,
    handleConfirmDiscard,
    handleCheckoutBranch,
    handleExpandUntrackedDir,
    handleCommit,
    handleCommitAndPush,
  } = useGitActions({
    commands,
    projectId: project.id,
    projectPath: project.path,
    onRefreshGit,
    onShowToast,
    onCommitMessageClear: () => setCommitMessage(''),
    selectedFiles,
    onSelectedFilesClear: clearSelected,
    onSelectedFilesRemove: removeSelected,
    changedFiles,
  });

  const { changedFilesWithStats } = useCommitPanelDiffStats({
    commands,
    projectId: project.id,
    changedFiles,
  });

  const { textareaHeight, handleDividerMouseDown } = useDividerDrag();

  const { aiGenerating, canAiGenerate, handleAiGenerate } = useAiCommitMessage({
    commands,
    capabilities,
    project,
    selectedFiles,
    onShowToast,
    onGenerated: setCommitMessage,
  });

  // ── 弹窗域：丢弃二次确认 + 分支/worktree 对话，状态与语义见各自 hook ──
  const discard = useDiscardConfirm(handleConfirmDiscard);
  const {
    dialog,
    open: openDialog,
    close: closeDialog,
  } = useGitDialogRequest({
    project,
    onOpenDialog,
  });

  // ── 以下回调全部稳定化：BranchInfo / ChangesList / CommitForm 均为 React.memo，
  //    内联箭头会在每次渲染击穿 memo ──
  const handleNewBranch = useCallback(() => openDialog('new-branch'), [openDialog]);

  const handleNewWorktree = useCallback(() => openDialog('new-worktree'), [openDialog]);

  const handleRefreshBranchInfo = useCallback(async () => {
    setLoading(true);
    try {
      await onRefreshGit();
    } finally {
      setLoading(false);
    }
  }, [setLoading, onRefreshGit]);

  const handleStageAllUntrackedClick = useCallback(() => {
    void handleStageAllUntracked(
      changedFiles.filter((f) => f.status === 'Untracked').map((f) => f.path),
    );
  }, [handleStageAllUntracked, changedFiles]);

  const handleFileSelect = useCallback((path: string) => onSelectFile?.(path), [onSelectFile]);

  const handleOpenFile = useCallback(
    (path: string) => void openProjectFile({ projectId: project.id, filePath: path }),
    [project.id],
  );

  const handleCredentialCancel = useCallback(() => {
    setCredentialDialog({ open: false, host: '', usernameHint: null, setUpstream: false });
  }, [setCredentialDialog]);

  // GitDialog onRefreshGit shim: local dialogs pass projectId, but we use onRefreshGit() directly
  const handleDialogRefreshGit = useCallback(() => {
    onRefreshGit().catch(console.error);
  }, [onRefreshGit]);

  return (
    <div className="flex flex-col h-full gap-0.5 p-1.5">
      {dialog && (
        <GitDialog dialog={dialog} onClose={closeDialog} onRefreshGit={handleDialogRefreshGit} />
      )}
      <GitCredentialDialog
        open={credentialDialog.open}
        host={credentialDialog.host}
        usernameHint={credentialDialog.usernameHint}
        onSubmit={handleCredentialSubmit}
        onCancel={handleCredentialCancel}
      />
      <BranchInfo
        gitInfo={project.gitInfo ?? null}
        projectId={project.id}
        aheadBehind={aheadBehind}
        loading={loading}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={handleRefreshBranchInfo}
        onNewBranch={handleNewBranch}
        onNewWorktree={handleNewWorktree}
        onCheckoutBranch={handleCheckoutBranch}
      />

      <DiscardConfirmDialog
        intent={discard.pending}
        onCancel={discard.cancel}
        onConfirm={discard.confirm}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-md">
        {noCommits ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[var(--font-size)] text-text-muted py-4">No commits yet</span>
          </div>
        ) : (
          <ChangesList
            /* 缓存作用域 = 仓库单元：主仓与 worktree 的相对路径**同形不同义**
               （同一 `src/a.ts` 在两个工作树里是两个文件），因此展开缓存
               （dirFilesMap）与勾选集必须随单元重挂载，不能只按项目。 */
            key={repoKey}
            repoKey={repoKey}
            unknown={status === undefined}
            files={changedFilesWithStats}
            selectedFiles={selectedFiles}
            onToggleFile={toggleFile}
            onDiscard={discard.request}
            onStageFile={handleStageFile}
            onStageAllUntracked={handleStageAllUntrackedClick}
            onFileSelect={handleFileSelect}
            onOpenFile={handleOpenFile}
            onExpandUntrackedDir={handleExpandUntrackedDir}
            loading={loading}
            truncated={statusTruncated}
          />
        )}
      </div>

      <CommitPanelDivider onMouseDown={handleDividerMouseDown} />

      <CommitForm
        message={commitMessage}
        onMessageChange={setCommitMessage}
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        onAiGenerate={capabilities.canGenerateCommitMessage ? handleAiGenerate : undefined}
        canAiGenerate={canAiGenerate}
        aiGenerating={aiGenerating}
        loading={loading}
        textareaHeight={textareaHeight}
      />
    </div>
  );
};

export default React.memo(GitCommitPanel);
