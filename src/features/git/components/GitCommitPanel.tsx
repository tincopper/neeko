import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { useAppContext } from '@/shared/contexts';
import type { AheadBehind, CommitResult, PushOutcome } from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';
import { withTimeout } from '@/shared/utils/withTimeout';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/Dialog';

import BranchInfo from './BranchInfo';
import ChangesList from './ChangesList';
import CommitForm from './CommitForm';
import GitCredentialDialog from './GitCredentialDialog';
import GitDialog, { type DialogState } from './GitDialog';

// Timeout constants (ms). These protect against indefinite IPC hangs caused by
// the Rust backend's project_manager Mutex being held by a long operation.
const TIMEOUT_LOCAL_MS = 30_000; // discard, stage, commit
const TIMEOUT_NETWORK_MS = 30_000; // fetch, pull, push

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
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState<
    { type: 'file'; path: string } | { type: 'all'; count: number } | null
  >(null);
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean;
    host: string;
    usernameHint: string | null;
    setUpstream: boolean;
  }>({ open: false, host: '', usernameHint: null, setUpstream: false });

  // 从 URL 中提取可读的 hostname（仅显示域名部分）
  const formatHost = (url: string): string => {
    try {
      const cleaned = url.replace(/^git@/, '').replace(/\.git$/, '');
      if (cleaned.includes('://')) {
        const afterProtocol = cleaned.split('://')[1];
        const withoutUser = afterProtocol.includes('@')
          ? afterProtocol.split('@')[1]
          : afterProtocol;
        return withoutUser;
      }
      if (cleaned.includes(':')) {
        return cleaned.split(':')[0];
      }
      return cleaned;
    } catch {
      return url;
    }
  };

  /** Handle the result of push/pull/fetch. Returns true if caller should stop further processing. */
  const handlePushOutcome = useCallback(
    (outcome: PushOutcome, _opName: string, setUpstream: boolean = false): boolean => {
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
            host: formatHost(remote_url),
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

  const [textareaHeight, setTextareaHeight] = useState(120);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // AI 生成 commit message 相关状�?
  const [commitMessage, setCommitMessage] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const { config } = useAppContext();

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
          setSelectedFiles(new Set());
          setCommitMessage('');
          onShowToast?.('Pushed successfully', 'info');
        }
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [commands, onRefreshGit, onShowToast, handlePushOutcome, credentialDialog.setUpstream],
  );

  const changedFiles = useMemo(
    () => project.gitInfo?.changed_files ?? [],
    [project.gitInfo?.changed_files],
  );

  const noCommits =
    project.gitInfo !== null &&
    project.gitInfo.branches.length === 0 &&
    !project.gitInfo.current_branch;

  // Diff stats 懒加载：首次渲染后异步获�?+/- 统计
  const [diffStats, setDiffStats] = useState<
    Record<string, { additions: number; deletions: number }>
  >({});
  // Reset diffStats when changes clear
  const prevHasChangesRef = useRef(changedFiles.length > 0);
  useEffect(() => {
    if (changedFiles.length === 0 && prevHasChangesRef.current) {
      prevHasChangesRef.current = false;
      setDiffStats({});
    } else if (changedFiles.length > 0) {
      prevHasChangesRef.current = true;
    }
  }, [changedFiles]);

  useEffect(() => {
    if (changedFiles.length === 0) return;
    let cancelled = false;
    commands
      .getChangedFilesDiffStats()
      .then((stats) => {
        if (cancelled) return;
        const map: Record<string, { additions: number; deletions: number }> = {};
        for (const s of stats) {
          map[s.path] = { additions: s.additions, deletions: s.deletions };
        }
        setDiffStats(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, changedFiles.length, commands]);

  // 合并 diff stats 到文件列�?
  const changedFilesWithStats = changedFiles.map((f) => ({
    ...f,
    additions: diffStats[f.path]?.additions ?? f.additions,
    deletions: diffStats[f.path]?.deletions ?? f.deletions,
  }));

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { startY: e.clientY, startHeight: textareaHeight };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.startY - ev.clientY;
        const newHeight = Math.max(40, Math.min(300, dragStartRef.current.startHeight + delta));
        setTextareaHeight(newHeight);
      };

      const onMouseUp = () => {
        dragStartRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [textareaHeight],
  );

  // Guard against userSelect/cursor leak: if this component unmounts while a
  // divider drag is still in progress the document-level mouseup handler will
  // never fire, leaving body styles permanently dirty.
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // AI 按钮仅当 capabilities.canGenerateCommitMessage 且已选择 agent 时可�?
  const canAiGenerate = capabilities.canGenerateCommitMessage && !!project.selectedAgent;

  const handleAiGenerate = useCallback(async () => {
    if (!capabilities.canGenerateCommitMessage || !project.selectedAgent) return;
    const files = Array.from(selectedFiles);
    if (files.length === 0) {
      onShowToast?.('No files selected. Please select files to generate commit message.', 'error');
      return;
    }
    setAiGenerating(true);
    try {
      const selectedAgent = project.selectedAgent?.[0] ?? '';
      const agentCommandOverride = config.agentCommandOverrides?.[selectedAgent] ?? null;
      const generated = await commands.generateCommitMessage(
        selectedAgent,
        files,
        agentCommandOverride,
      );
      setCommitMessage(generated.trim());
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setAiGenerating(false);
    }
  }, [
    capabilities.canGenerateCommitMessage,
    project.selectedAgent,
    selectedFiles,
    commands,
    config.agentCommandOverrides,
    onShowToast,
  ]);

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

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardConfirm) return;
    const confirm = discardConfirm;
    setDiscardConfirm(null);
    setLoading(true);
    try {
      if (confirm.type === 'file') {
        await withTimeout(commands.discardFile(confirm.path), TIMEOUT_LOCAL_MS, 'discard');
      } else {
        await withTimeout(commands.discardAll(), TIMEOUT_LOCAL_MS, 'discard-all');
      }
      await onRefreshGit();
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (confirm.type === 'all') {
          next.clear();
        } else {
          next.delete(confirm.path);
        }
        return next;
      });
      onShowToast?.(confirm.type === 'all' ? 'Discarded all changes' : 'Discarded changes', 'info');
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [commands, discardConfirm, onRefreshGit, onShowToast]);

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

  const handleStageAllUntracked = useCallback(async () => {
    const untrackedPaths = changedFiles.filter((f) => f.status === 'Untracked').map((f) => f.path);
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
  }, [changedFiles, commands, onRefreshGit, onShowToast]);

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
        setSelectedFiles(new Set());
        setCommitMessage('');
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
    [selectedFiles, commands, onRefreshGit, onShowToast],
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
        const outcome = await withTimeout(commands.push(false), TIMEOUT_NETWORK_MS, 'push');
        if (handlePushOutcome(outcome, 'push')) return; // AuthRequired handled
        await onRefreshGit();
        setSelectedFiles(new Set());
        setCommitMessage('');
        onShowToast?.('Committed & pushed successfully', 'info');
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [selectedFiles, commands, onRefreshGit, onShowToast, handlePushOutcome],
  );

  const handleFetch = useCallback(async () => {
    setLoading(true);
    try {
      const outcome = await withTimeout(commands.fetch(), TIMEOUT_NETWORK_MS, 'fetch');
      if (handlePushOutcome(outcome, 'fetch')) return;
      // fetch 后刷新 changed_files + ahead/behind（待 push/pull 数量）
      await onRefreshGit();
      onShowToast?.('Fetched successfully', 'info');
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast, handlePushOutcome]);

  const handlePull = useCallback(async () => {
    setLoading(true);
    try {
      const outcome = await withTimeout(commands.pull(), TIMEOUT_NETWORK_MS, 'pull');
      if (handlePushOutcome(outcome, 'pull')) return;
      await onRefreshGit();
      onShowToast?.('Pulled successfully', 'info');
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast, handlePushOutcome]);

  const handlePush = useCallback(async () => {
    setLoading(true);
    try {
      const outcome = await withTimeout(commands.push(false), TIMEOUT_NETWORK_MS, 'push');
      if (handlePushOutcome(outcome, 'push')) return;
      await onRefreshGit();
      onShowToast?.('Pushed successfully', 'info');
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast, handlePushOutcome]);

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
            <Button variant="destructive" onClick={handleConfirmDiscard}>
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
            onStageAllUntracked={handleStageAllUntracked}
            onFileSelect={(path) => onSelectFile?.(path)}
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
