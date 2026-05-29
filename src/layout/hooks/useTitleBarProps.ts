import { useState, useCallback } from "react";
import type { Project, WSLProject, RemoteProject, RemoteEntrySession } from "../../types";
import type { TitleBar } from "../../components/layout";

interface UseTitleBarPropsInput {
  activeProject: Project | null;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeWorktreeBranch: string;
  handleRefreshGit: (projectId: string) => Promise<void>;
  handleRefreshWslGit: (
    distro: string,
    projectId: string,
    projectPath: string,
  ) => Promise<void>;
  handleRefreshRemoteGit: (
    entryId: string,
    projectId: string,
    projectPath: string,
  ) => Promise<void>;
  wslActiveWtBranch: string;
  remoteActiveWtBranch: string;
  checkoutBranch: ((branchName: string) => Promise<void>) | null;
  showToast: (message: string, type?: "info" | "error") => void;
}

export function useTitleBarProps(
  input: UseTitleBarPropsInput,
): React.ComponentProps<typeof TitleBar> {
  const [isBranchSwitching, setIsBranchSwitching] = useState(false);

  const handleTitleBarRefreshGit = useCallback(async () => {
    if (input.activeProject) {
      await input.handleRefreshGit(input.activeProject.id);
    } else if (input.activeWslProject) {
      await input.handleRefreshWslGit(
        input.activeWslProject.distro,
        input.activeWslProject.project.id,
        input.activeWslProject.project.path,
      );
    } else if (input.activeRemoteProject) {
      await input.handleRefreshRemoteGit(
        input.activeRemoteProject.entry.id,
        input.activeRemoteProject.project.id,
        input.activeRemoteProject.project.path,
      );
    }
  }, [
    input.activeProject,
    input.activeWslProject,
    input.activeRemoteProject,
    input.handleRefreshGit,
    input.handleRefreshWslGit,
    input.handleRefreshRemoteGit,
  ]);

  const handleTitleBarCheckoutBranch = useCallback(
    async (branchName: string) => {
      if (!input.checkoutBranch) return;
      setIsBranchSwitching(true);
      try {
        await input.checkoutBranch(branchName);
        await handleTitleBarRefreshGit();
      } catch (e: unknown) {
        input.showToast(String(e), "error");
      } finally {
        setIsBranchSwitching(false);
      }
    },
    [input.checkoutBranch, handleTitleBarRefreshGit, input.showToast],
  );

  const titleBarBranches =
    input.activeProject?.git_info?.branches ??
    input.activeWslProject?.project.git_info?.branches ??
    input.activeRemoteProject?.project.git_info?.branches ??
    [];

  return {
    activeProject: input.activeProject,
    activeWslProject: input.activeWslProject,
    activeRemoteProject: input.activeRemoteProject,
    activeWorktreeBranch: input.activeWorktreeBranch,
    activeWslWorktreeBranch: input.wslActiveWtBranch,
    activeRemoteWorktreeBranch: input.remoteActiveWtBranch,
    branches: titleBarBranches,
    isBranchSwitching,
    onCheckoutBranch: handleTitleBarCheckoutBranch,
    onRefreshGit: handleTitleBarRefreshGit,
  };
}
