import React, { useState, useCallback, useMemo } from 'react';

import { openProjectFile } from '@/features/quick-open';
import type { AheadBehind } from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/Dialog';

import {
  useAiCommitMessage,
  useCommitPanelDiffStats,
  useDividerDrag,
} from '../hooks/useCommitPanelAux';
import { useGitActions } from '../hooks/useGitActions';

import BranchInfo from './BranchInfo';
import ChangesList from './ChangesList';
import CommitForm from './CommitForm';
import GitCredentialDialog from './GitCredentialDialog';
import GitDialog, { type DialogState } from './GitDialog';

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
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState<
    { type: 'file'; path: string } | { type: 'all'; count: number } | null
  >(null);
  const [commitMessage, setCommitMessage] = useState('');

  const changedFiles = useMemo(
    () => project.gitInfo?.changed_files ?? [],
    [project.gitInfo?.changed_files],
  );

  // ── Git 操作域（fetch/pull/push/commit/stage/凭据对话），见 useGitActions ──
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
    handleCommit,
    handleCommitAndPush,
  } = useGitActions({
    commands,
    onRefreshGit,
    onShowToast,
    onCommitMessageClear: () => setCommitMessage(''),
    selectedFiles,
    onSelectedFilesClear: () => setSelectedFiles(new Set()),
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

  const noCommits =
    project.gitInfo !== null &&
    project.gitInfo.branches.length === 0 &&
    !project.gitInfo.current_branch;

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleDiscardFile = useCallback((path: string) => {
    setDiscardConfirm({ type: 'file', path });
  }, []);

  const handleDiscardAllRequest = useCallback(() => {
    setDiscardConfirm({ type: 'all', count: changedFiles.length });
  }, [changedFiles.length]);

  const handleCancelDiscard = useCallback(() => {
    setDiscardConfirm(null);
  }, []);

  const handleNewBranch = useCallback(() => {
    if (onOpenDialog) {
      onOpenDialog('new-branch', {} as React.MouseEvent);
    } else {
      setDialog({
        type: 'new-branch',
        projectId: project.id,
        branches: project.gitInfo?.branches ?? [],
        projectPath: project.path,
      });
    }
  }, [onOpenDialog, project]);

  const handleNewWorktree = useCallback(() => {
    if (onOpenDialog) {
      onOpenDialog('new-worktree', {} as React.MouseEvent);
    } else {
      setDialog({
        type: 'new-worktree',
        projectId: project.id,
        branches: project.gitInfo?.branches ?? [],
        projectPath: project.path,
      });
    }
  }, [onOpenDialog, project]);

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

  // 展开折叠的 untracked 目录条目：按需拉取目录下的 untracked 文件列表
  const handleExpandUntrackedDir = useCallback(
    async (dirPath: string) => {
      try {
        return await commands.listUntrackedFiles(dirPath);
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
        return [];
      }
    },
    [commands, onShowToast],
  );

  const handleDialogClose = useCallback(() => {
    setDialog(null);
  }, []);

  // GitDialog onRefreshGit shim: local dialogs pass projectId, but we use onRefreshGit() directly
  const handleDialogRefreshGit = useCallback(() => {
    onRefreshGit().catch(console.error);
  }, [onRefreshGit]);

  return (
    <div className="flex flex-col h-full gap-0.5 p-1.5">
      {dialog && (
        <GitDialog
          dialog={dialog}
          onClose={handleDialogClose}
          onRefreshGit={handleDialogRefreshGit}
        />
      )}
      <GitCredentialDialog
        open={credentialDialog.open}
        host={credentialDialog.host}
        usernameHint={credentialDialog.usernameHint}
        onSubmit={handleCredentialSubmit}
        onCancel={() =>
          setCredentialDialog({ open: false, host: '', usernameHint: null, setUpstream: false })
        }
      />
      <BranchInfo
        gitInfo={project.gitInfo ?? null}
        projectId={project.id}
        aheadBehind={aheadBehind}
        loading={loading}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={async () => {
          setLoading(true);
          try {
            await onRefreshGit();
          } finally {
            setLoading(false);
          }
        }}
        onNewBranch={handleNewBranch}
        onNewWorktree={handleNewWorktree}
        onCheckoutBranch={handleCheckoutBranch}
      />

      <Dialog open={!!discardConfirm} onOpenChange={(open) => !open && setDiscardConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {discardConfirm?.type === 'all' ? 'Discard all changes?' : 'Discard changes?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-text-secondary">
            {discardConfirm?.type === 'all'
              ? `This will discard all ${discardConfirm.count} changes and delete untracked files. This action cannot be undone.`
              : `This will discard changes in '${discardConfirm?.path}' and cannot be undone.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDiscard}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const pending = discardConfirm;
                if (!pending) return;
                setDiscardConfirm(null);
                void handleConfirmDiscard(pending);
              }}
            >
              {discardConfirm?.type === 'all' ? 'Discard All' : 'Discard'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-md">
        {noCommits ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[var(--font-size)] text-text-muted py-4">No commits yet</span>
          </div>
        ) : (
          <ChangesList
            files={changedFilesWithStats}
            selectedFiles={selectedFiles}
            onToggleFile={toggleFile}
            onDiscardFile={handleDiscardFile}
            onDiscardAll={handleDiscardAllRequest}
            onStageFile={handleStageFile}
            onStageAllUntracked={() =>
              void handleStageAllUntracked(
                changedFiles.filter((f) => f.status === 'Untracked').map((f) => f.path),
              )
            }
            onFileSelect={(path) => onSelectFile?.(path)}
            onOpenFile={(path) => void openProjectFile({ projectId: project.id, filePath: path })}
            onExpandUntrackedDir={handleExpandUntrackedDir}
            loading={loading}
          />
        )}
      </div>

      {/* Draggable divider */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        role="separator"
        tabIndex={0}
        className="group h-1.5 shrink-0 cursor-row-resize flex items-center justify-center"
        aria-orientation="horizontal"
        aria-label="Resize commit area"
        onMouseDown={handleDividerMouseDown}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
      >
        <div className="w-8 h-[3px] rounded-full bg-border group-hover:bg-accent-blue/50 transition-colors duration-150" />
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}

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
