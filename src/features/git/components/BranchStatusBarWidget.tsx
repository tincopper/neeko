import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { BranchIcon, ArrowDown, ArrowUp } from '@/shared/components/icons';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { GitInfo } from '@/shared/types';
import { filterWorktreeBranches } from '@/shared/utils';
import { cn } from '@/shared/utils/cn';

import BranchSwitcherPanel from './BranchSwitcherPanel';

interface BranchStatusBarWidgetProps {
  onNewBranch: () => void;
  onNewWorktree: () => void;
  onCheckoutBranch: (branchName: string) => void;
}

function BranchStatusBarWidget({
  onNewBranch,
  onNewWorktree,
  onCheckoutBranch,
}: BranchStatusBarWidgetProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | undefined>(undefined);

  const activeProject = useProjectStore((s) => s.activeProject);
  const gitInfo: GitInfo | null = activeProject?.git_info ?? null;
  const projectId = activeProject?.id ?? '';
  const currentBranch = gitInfo?.current_branch ?? '';
  const branches = gitInfo?.branches ?? [];
  const worktrees = gitInfo?.worktrees ?? [];

  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
  const isWorktreeActive = activeWorktreePath !== null;
  const displayBranch = isWorktreeActive ? activeWorktreeBranch : currentBranch;

  const favoriteBranches = useGitStore(useShallow((s) => s.favoriteBranches[projectId] ?? []));
  const toggleFavorite = useGitStore((s) => s.toggleFavorite);
  const aheadBehind = useGitStore(
    useShallow((s) => (projectId ? (s.aheadBehind[projectId] ?? null) : null)),
  );

  const availableBranches = useMemo(
    () => filterWorktreeBranches(branches, worktrees),
    [worktrees, branches],
  );

  const aheadBehindMap = useMemo(() => {
    if (!aheadBehind || !displayBranch) return {};
    return { [displayBranch]: { ahead: aheadBehind.ahead, behind: aheadBehind.behind } };
  }, [aheadBehind, displayBranch]);

  const handleToggleFavorite = useCallback(
    (branchName: string) => {
      toggleFavorite(projectId, branchName);
    },
    [projectId, toggleFavorite],
  );

  const handleCheckout = useCallback(
    (branchName: string) => {
      onCheckoutBranch(branchName);
    },
    [onCheckoutBranch],
  );

  // Worktree cannot switch branches — disable panel when worktree is active
  const handleTogglePanel = useCallback(() => {
    if (isWorktreeActive) return;
    setPanelOpen((v) => !v);
  }, [isWorktreeActive]);

  useEffect(() => {
    if (panelOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
      });
    } else {
      setPanelStyle(undefined);
    }
  }, [panelOpen]);

  if (!gitInfo || !displayBranch) return null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cn(
          'flex items-center gap-1 hover:text-text-primary cursor-pointer transition-colors shrink-0',
          isWorktreeActive && 'opacity-70 cursor-default',
        )}
        onClick={handleTogglePanel}
        title={
          isWorktreeActive
            ? `Worktree branch: ${displayBranch} (read-only)`
            : `Current branch: ${displayBranch}`
        }
      >
        <BranchIcon size={12} className="shrink-0 text-accent-blue" />
        <span className="truncate max-w-[120px] font-mono text-[12px]">{displayBranch}</span>
        {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <span className="flex items-center gap-1 text-[11px]">
            {aheadBehind.behind > 0 && (
              <span className="flex items-center gap-0.5 text-accent-blue">
                <ArrowDown size={9} />
                {aheadBehind.behind}
              </span>
            )}
            {aheadBehind.ahead > 0 && (
              <span className="flex items-center gap-0.5 text-accent-green">
                <ArrowUp size={9} />
                {aheadBehind.ahead}
              </span>
            )}
          </span>
        )}
      </button>

      {panelOpen &&
        panelStyle &&
        createPortal(
          <>
            <button
              className="fixed inset-0 z-[999] w-full h-full cursor-default"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
              type="button"
            />
            <div className="fixed z-[1000]" style={panelStyle}>
              <BranchSwitcherPanel
                branches={availableBranches}
                currentBranch={displayBranch}
                favoriteBranches={favoriteBranches}
                aheadBehind={aheadBehindMap}
                onCheckout={(name) => {
                  handleCheckout(name);
                  setPanelOpen(false);
                }}
                onToggleFavorite={handleToggleFavorite}
                onNewBranch={() => {
                  setPanelOpen(false);
                  onNewBranch();
                }}
                onNewWorktree={() => {
                  setPanelOpen(false);
                  onNewWorktree();
                }}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export { BranchStatusBarWidget };
export default BranchStatusBarWidget;
