import React, { useState, useCallback, useMemo } from 'react';

import { openProjectFile } from '@/features/quick-open';
import { useGitStore } from '@/shared/store/gitStore';
import type { AheadBehind } from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';

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
}) => {
  const [commitMessage, setCommitMessage] = useState('');

  // G4（P3）：快照截断状态（versioned snapshot 的 truncated 位；store 响应式）
  const statusTruncated = useGitStore((s) => s.truncatedByProject[project.id] ?? false);

  const changedFiles = useMemo(
    () => project.gitInfo?.changed_files ?? [],
    [project.gitInfo?.changed_files],
  );

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
            /* 缓存作用域：切换项目即重挂载 —— 展开缓存（dirFilesMap）按目录 path 键存
               在 hook 状态里，跨项目复用会把上一个项目的子文件显示到同名目录下 */
            key={project.id}
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
