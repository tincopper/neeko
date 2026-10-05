import React, { useState, useEffect, useCallback } from 'react';

import { useImeSpaceGuard } from '@/shared/hooks/useImeSpaceGuard';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveWorktreePath, useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange } from '@/shared/types';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/Dialog';
import { noAutocorrectProps } from '@/ui/inputDefaults';

import {
  commitFiles,
  push,
  pull,
  getRepoStatus,
  getCommitLog,
  type PushOutcome,
} from '../api/gitApi';
import { beginGitConsoleRun, GIT_BUSY_MESSAGE, runGitConsoleOp } from '../api/gitConsoleRun';
import { isConflictedEntry } from '../utils/gitStatusGroups';

interface CommitDialogProps {
  projectId: string;
  onClose: () => void;
  onRefreshGit: (projectId: string) => void;
}

function CommitDialog({ projectId, onClose, onRefreshGit }: CommitDialogProps) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorktreePath = useWorktreeStore((s) => selectActiveWorktreePath(s, activeProjectId));
  const worktreePath = activeProjectId === projectId ? activeWorktreePath : null;
  const projectPath = useProjectStore(
    (s) => s.projects.find((p) => p.id === projectId)?.path ?? '',
  );

  const [files, setFiles] = useState<FileChange[]>([]);
  const [untrackedCount, setUntrackedCount] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useImeSpaceGuard<HTMLTextAreaElement>();
  // Reset message when amend changes to false
  useEffect(() => {
    if (!amend) {
      // Defer to avoid sync setState in effect
      Promise.resolve().then(() => setMessage(''));
    }
  }, [amend]);

  useEffect(() => {
    getRepoStatus(projectId, worktreePath)
      .then((snapshot) => {
        const untracked = snapshot.entries.filter((f) => f.status === 'Untracked');
        setUntrackedCount(untracked.length);
        setFiles(snapshot.entries.filter((f) => f.status !== 'Untracked'));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setFilesLoading(false));
  }, [projectId, worktreePath]);

  useEffect(() => {
    if (!amend) return;
    getCommitLog(projectId, 1)
      .then((entries) => {
        if (entries.length > 0) setMessage(entries[0].message);
      })
      .catch((err) => reportFrontendError('git.commitLog', err));
  }, [amend, projectId]);

  /** Convert a PushOutcome into an error message string if it's AuthRequired, or return undefined for Success. */
  function pushOutcomeMsg(outcome: PushOutcome): string | undefined {
    if ('AuthRequired' in outcome) {
      const { remote_url, ssh, username_hint } = outcome.AuthRequired;
      if (ssh) {
        return 'SSH authentication failed. Ensure ssh-agent is running and key is added via ssh-add.';
      }
      const hint = username_hint ? ` (user: ${username_hint})` : '';
      return `Authentication required for ${remote_url}${hint}. Use the credentials dialog in the main panel, or configure git credentials via terminal.`;
    }
    return undefined;
  }

  const handleCommit = useCallback(
    async (pushAfter: boolean) => {
      if (!message.trim()) return;
      // W1 根治：与后端 commit_files 守卫一致，阻止未解决冲突提交
      // （安全底线在后端 ensure_no_unmerged；此处提供对话框内即时提示）
      if (files.some(isConflictedEntry)) {
        setError('Cannot commit: unresolved merge conflict selected. Resolve conflicts first.');
        return;
      }
      setError(null);
      const filePaths = files.map((f) => f.path);
      // commit 与 push 共用一个 Console run（同 useGitActions）：一个 header，两段输出连续落屏。
      const consoleRun = pushAfter
        ? beginGitConsoleRun(projectId, projectPath, 'git commit && git push')
        : null;
      if (pushAfter && !consoleRun) {
        setError(GIT_BUSY_MESSAGE);
        return;
      }
      setSubmitting(true);
      try {
        if (consoleRun) {
          await commitFiles(projectId, filePaths, message.trim(), worktreePath, consoleRun.runId);
          const outcome = await push(projectId, false, worktreePath, consoleRun.runId);
          if ('AuthRequired' in outcome) {
            consoleRun.awaitAuth();
            setError(pushOutcomeMsg(outcome) ?? 'Authentication required.');
            return;
          }
          consoleRun.finishOk();
        } else {
          const result = await runGitConsoleOp({
            header: 'git commit',
            projectId,
            projectPath,
            run: (runId) => commitFiles(projectId, filePaths, message.trim(), worktreePath, runId),
          });
          if (result.status === 'busy') {
            setError(GIT_BUSY_MESSAGE);
            return;
          }
          if (result.status === 'stopped') return; // 用户取消
        }
        onRefreshGit(projectId);
        onClose();
      } catch (e) {
        if (consoleRun?.fail(e)) return; // 用户取消：静默（已按 [Stopped] 收尾）
        setError(String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, projectPath, worktreePath, message, files, onRefreshGit, onClose],
  );

  const handlePush = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await runGitConsoleOp({
        header: 'git push',
        projectId,
        projectPath,
        run: (runId) => push(projectId, false, worktreePath, runId),
        isAuthRequired: (o) => 'AuthRequired' in o,
      });
      if (result.status === 'busy') {
        setError(GIT_BUSY_MESSAGE);
        return;
      }
      if (result.status === 'stopped') return; // 用户取消
      const msg = pushOutcomeMsg(result.value);
      if (msg) {
        setError(msg);
        return;
      }
      onRefreshGit(projectId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, projectPath, worktreePath, onRefreshGit, onClose]);

  const handlePull = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await runGitConsoleOp({
        header: 'git pull',
        projectId,
        projectPath,
        run: (runId) => pull(projectId, worktreePath, runId),
        isAuthRequired: (o) => 'AuthRequired' in o,
      });
      if (result.status === 'busy') {
        setError(GIT_BUSY_MESSAGE);
        return;
      }
      if (result.status === 'stopped') return; // 用户取消
      const msg = pushOutcomeMsg(result.value);
      if (msg) {
        setError(msg);
        return;
      }
      onRefreshGit(projectId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, projectPath, worktreePath, onRefreshGit, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
        </DialogHeader>

        {/* File list */}
        <div className="mb-3">
          <span className="text-xs text-text-secondary uppercase tracking-wide">
            Files ({files.length})
          </span>
          {filesLoading ? (
            <p className="text-text-muted text-[13px] mt-1">Loading...</p>
          ) : files.length === 0 && untrackedCount === 0 ? (
            <p className="text-text-muted text-[13px] mt-1">No uncommitted changes</p>
          ) : (
            <div className="max-h-[140px] overflow-y-auto mt-1 border border-border rounded-md bg-bg-secondary/50">
              {files.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] border-b border-border/50 last:border-b-0"
                >
                  <span className="text-accent-green shrink-0 text-[11px] font-bold w-4">
                    {f.status[0]}
                  </span>
                  <span className="text-text-primary truncate">{f.path}</span>
                  {f.additions > 0 && (
                    <span className="text-green-500 text-[11px] shrink-0">+{f.additions}</span>
                  )}
                  {f.deletions > 0 && (
                    <span className="text-red-500 text-[11px] shrink-0">-{f.deletions}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {untrackedCount > 0 && (
            <p className="text-[11px] text-text-muted mt-1">
              {untrackedCount} untracked file{untrackedCount > 1 ? 's' : ''} not shown (stage them
              in the Git panel first)
            </p>
          )}
        </div>

        {/* Amend checkbox */}
        <div className="mb-3">
          <Checkbox
            checked={amend}
            onCheckedChange={(checked) => setAmend(!!checked)}
            label="Amend last commit"
          />
        </div>

        {/* Message */}
        <textarea
          {...noAutocorrectProps}
          className="w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text-primary placeholder-text-muted resize-none outline-none focus:border-accent"
          rows={4}
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleCommit(false);
            }
          }}
          onCompositionEnd={(e) => {
            guard.onCompositionEnd(e);
          }}
        />

        {error && (
          <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mt-3 text-[13px]">
            {error}
          </p>
        )}

        <DialogFooter className="flex-col gap-2">
          <div className="flex items-center gap-2 w-full">
            <Button
              variant="secondary"
              onClick={handlePull}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? '...' : 'Pull'}
            </Button>
            <Button
              variant="secondary"
              onClick={handlePush}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? '...' : 'Push'}
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCommit(false)}
              disabled={!message.trim() || submitting || files.length === 0}
              className="flex-1"
            >
              {submitting ? 'Committing...' : 'Commit'}
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCommit(true)}
              disabled={!message.trim() || submitting || files.length === 0}
              className="flex-1"
            >
              {submitting ? '...' : 'Commit & Push'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default React.memo(CommitDialog);
