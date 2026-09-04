import { useCallback } from 'react';

import { BranchStatusBarWidget } from '@/features/git';
import { useActiveProject } from '@/features/project';
import { useProjectStore } from '@/shared/store/projectStore';

/** 左簇常驻项：分支切换（无 activeProjectId 时隐藏）。 */
export function BranchItem() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const { commands } = useActiveProject();

  const handleStatusBarCheckout = useCallback(
    async (branchName: string) => {
      try {
        await commands?.checkoutBranch(branchName);
        // Refresh git info after checkout
        if (activeProjectId) {
          await commands?.refreshGitInfo();
        }
      } catch (e) {
        console.error('[StatusBar] Checkout failed:', e);
      }
    },
    [commands, activeProjectId],
  );

  if (!activeProjectId) return null;

  return (
    <BranchStatusBarWidget
      onNewBranch={() => {}}
      onNewWorktree={() => {}}
      onCheckoutBranch={handleStatusBarCheckout}
    />
  );
}
