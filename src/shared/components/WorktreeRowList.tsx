import React, { useMemo } from 'react';

import DeleteConfirmDialog from '@/shared/components/DeleteConfirmDialog';
import { BranchIcon, TrashIcon } from '@/shared/components/icons';
import SessionRow from '@/shared/components/SessionRow';
import WorktreeRenameInput from '@/shared/components/WorktreeRenameInput';
import type { ConfirmDeleteState, WorktreeRowState } from '@/shared/hooks/useWorktreeRowState';
import {
  NO_SESSIONS,
  dominantState,
  sessionsByUnit,
} from '@/shared/selectors/liveSessionSelectors';
import { useGitStore } from '@/shared/store/gitStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import type { Worktree } from '@/shared/types';
import { getFileName } from '@/shared/utils/fileTree';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

interface WorktreeRowListProps {
  projectId: ProjectId;
  worktrees: Worktree[];
  /** 当前激活的 worktree 路径（`null` / 空串 = 主仓）。 */
  activeCheckoutPath: string | null;
  /** 行交互状态机（本地走 `useWorktreeListActions`，远端走 `useWorktreeRowState`）。 */
  rowState: WorktreeRowState;
  /** 点击行：打开该单元的终端。 */
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  /**
   * 该单元会话子列表的渲染入口（`UnitSessionList`）。
   *
   * 由调用方注入而不是在这里 import：本组件在 `shared/`，而会话行需要 agent 图标与
   * tab 激活 —— 那是 feature 侧的能力（分层约束：`shared/` 不得依赖 `features/`）。
   * 与 `rowState` 同模式：本组件只说「这一行长什么样」，能力由调用方给。
   *
   * 返回 `undefined` = 不提供子列表（行尾也不出现展开箭头）。
   */
  renderUnitSessions?: (workspaceKey: string) => React.ReactNode;
}

/**
 * linked worktree 行的**行级渲染**（本地侧栏与 WSL/SSH 侧栏的唯一实现）。
 *
 * **为什么抽到这里**：至此两域已经共用 `SessionRow`（视觉）、`useWorktreeRowState`（交互状态）
 * 与 `WorktreeRenameInput` / `DeleteConfirmDialog`（子件），但仍各自保留了一段 ~45 行的
 * `SessionRow` 装配（`editing` / `trailing` / `ahead` / `onClick` 的门）。`diff` 实测只有 3 处
 * 差异，其中 2 处是**意外漂移**（`hover:bg-bg-hover` vs `hover:bg-bg-tertiary`、可选的
 * `onOpenWorktreeTerminal?.(projectId,…)` vs 必选的 `(path, branch)`）—— 这正是
 * `.trellis/spec/guides/code-reuse-thinking-guide.md`「模式 5」的形态：副本初期等价，
 * 某处被单独修改后另一域静默失效。
 *
 * **边界**：本组件只做「一行长什么样、点了做什么」，域差异（回调地址形态、远端 spinner 延迟、
 * 是否需要回收 PTY）全在调用方注入的 `rowState` / 回调里 —— 差异是数据，不是第二份实现。
 *
 * `rowState` 的类型**由 hook 派生**（`WorktreeRowState = ReturnType<…>`），本组件不另立结构副本。
 */
const WorktreeRowList: React.FC<WorktreeRowListProps> = ({
  projectId,
  worktrees,
  activeCheckoutPath,
  rowState,
  onOpenWorktreeTerminal,
  renderUnitSessions,
}) => {
  // 「待 push 提交数」的唯一读取规则：键 = 本项目当前单元的 WorkspaceKey，只在激活行展示。
  // 该数字只有激活单元会被写入 store（见 `useAheadBehindSync` / `useGitStatusEventsSync`）——
  // 门与数据来源同一定义，不是视觉偏好。
  const activeUnitKey = useActiveWorkspaceKey(projectId);
  const activeAhead = useGitStore((s) =>
    activeUnitKey ? s.aheadBehind[activeUnitKey]?.ahead : undefined,
  );

  // 每个 worktree 行的角标与子列表都取自同一份快照（按 `workspaceKey` 分组，红线 12）。
  const sessions = useLiveSessionsStore((s) => s.sessions);
  const byUnit = useMemo(() => sessionsByUnit(sessions), [sessions]);

  if (worktrees.length === 0) return null;

  return (
    <>
      {worktrees.map((wt) => {
        const isRenaming = rowState.renaming === wt.path;
        const isDeleting = rowState.deleting === wt.path;
        const isActive = activeCheckoutPath === wt.path;
        // 该 worktree 的行本身就是单元身份 → 它的单元 key 是这张表的一行
        const unitKey = WorkspaceSession.of(projectId, wt.path).key;
        const unitSessions = byUnit.get(unitKey) ?? NO_SESSIONS;

        return (
          <SessionRow
            key={wt.path}
            kind="worktree"
            label={getFileName(wt.path)}
            branch={wt.branch}
            isActive={isActive}
            ahead={isActive ? activeAhead : undefined}
            title={`${wt.path}\nClick to open terminal`}
            onClick={(e) => {
              e.stopPropagation();
              if (isRenaming || isDeleting) return;
              onOpenWorktreeTerminal(wt.path, wt.branch);
            }}
            editing={
              isRenaming ? (
                <WorktreeRenameInput
                  inputRef={rowState.renameInputRef}
                  value={rowState.renameValue}
                  onChange={rowState.setRenameValue}
                  onCommit={rowState.commitRename}
                  onCancel={rowState.cancelRename}
                />
              ) : undefined
            }
            onLabelDoubleClick={(e) => rowState.startRename(wt.path, e)}
            labelTitle="Double-click to rename"
            deleting={isDeleting}
            status={dominantState(unitSessions)}
            trailing={
              isDeleting ? (
                <span className="wt-spinner" title="Removing..." />
              ) : (
                <button
                  data-no-drag
                  type="button"
                  className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-hover hover:!text-accent-red opacity-0 group-hover:opacity-100"
                  onClick={(e) => rowState.handleRemove(wt.path, wt.branch, e)}
                  title="Remove worktree and branch"
                >
                  <TrashIcon size={12} />
                </button>
              )
            }
          >
            {unitSessions.length > 0 ? renderUnitSessions?.(unitKey) : undefined}
          </SessionRow>
        );
      })}
      <DeleteConfirmDialog
        pending={rowState.confirmDelete}
        onCancel={rowState.dismissConfirmDelete}
        onConfirm={(s) => rowState.confirmRemove(s.path, s.branch)}
        title="Remove Worktree"
        confirmLabel={(s: ConfirmDeleteState) => (s.isDirty ? 'Force Remove' : 'Remove')}
        describe={(s: ConfirmDeleteState) => (
          <>
            {s.isDirty ? (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed text-accent-yellow bg-accent-yellow/[0.08] p-2 px-3 rounded-md border-l-[3px] border-accent-yellow">
                This worktree has uncommitted changes. Removing it will discard all local changes.
                Are you sure?
              </p>
            ) : (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                Remove worktree <strong className="text-accent-blue">{getFileName(s.path)}</strong>{' '}
                and delete branch <strong className="text-accent-blue">{s.branch}</strong>?
              </p>
            )}
            <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
              <span className="text-text-muted break-all">{s.path}</span>
              <span className="flex items-center gap-1 text-accent-green">
                <BranchIcon size={11} /> {s.branch}
              </span>
            </div>
          </>
        )}
      />
    </>
  );
};

export default React.memo(WorktreeRowList);
