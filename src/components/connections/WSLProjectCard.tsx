import React, { useCallback, useMemo } from "react";
import ProjectItemCard from "./ProjectItemCard";
import type { WSLProjectCardProps } from "./types";
import type { FileChange } from "../../types";

const WSLProjectCard: React.FC<WSLProjectCardProps> = React.memo(
  ({
    project,
    entryId,
    distro,
    isActive,
    hasSession,
    onSelectProject,
    onRemoveProject,
    onSelectFile,
    onRefreshGit,
    onOpenIde,
    onOpenWorktreeTerminal,
    onOpenDialog,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
    onShowToast,
  }) => {
    const handleSelectFile = useCallback(
      (fp: string) => {
        onSelectFile?.(distro, project.path, fp);
      },
      [onSelectFile, distro, project.path],
    );

    const handleCheckout = useCallback(
      (branch: string) => {
        return import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("wsl_checkout_branch", {
            distro,
            projectPath: project.path,
            branchName: branch,
          }).then(() => onRefreshGit?.(distro, project.id, project.path) ?? Promise.resolve()),
        );
      },
      [distro, project.path, project.id, onRefreshGit],
    );

    const handleRenameBranch = useCallback(
      (oldName: string, newName: string) => {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("wsl_rename_branch", {
            distro,
            projectPath: project.path,
            oldName,
            newName,
          })
            .then(() => onRefreshGit?.(distro, project.id, project.path))
            .catch(console.error),
        );
      },
      [distro, project.path, project.id, onRefreshGit],
    );

    const handleOpenWorktree = useCallback(
      (wtPath: string, branch: string) => {
        onOpenWorktreeTerminal?.(distro, wtPath, branch);
      },
      [onOpenWorktreeTerminal, distro],
    );

    const handleRenameWorktree = useCallback(
      (oldPath: string, newName: string) => {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("wsl_rename_worktree", {
            distro,
            projectPath: project.path,
            worktreePath: oldPath,
            newName,
          })
            .then(() => onRefreshGit?.(distro, project.id, project.path))
            .catch(console.error),
        );
      },
      [distro, project.path, project.id, onRefreshGit],
    );

    const handleRemoveWorktree = useCallback(
      (wtPath: string, _branch: string) => {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("wsl_remove_worktree", {
            distro,
            projectPath: project.path,
            worktreePath: wtPath,
          })
            .then(() => onRefreshGit?.(distro, project.id, project.path))
            .catch((e: unknown) => {
              console.error("[WSL] Failed to remove worktree:", e);
            }),
        );
      },
      [distro, project.path, project.id, onRefreshGit],
    );

    const handleRemove = useCallback(() => {
      onRemoveProject(entryId, project.id);
    }, [onRemoveProject, entryId, project.id]);

    const handleOpenIde = useMemo(
      () =>
        onOpenIde
          ? () => onOpenIde(distro, project.path, project.selected_ide ?? "")
          : undefined,
      [onOpenIde, distro, project.path, project.selected_ide],
    );

    const handleOpenDialog = useMemo(
      () =>
        onOpenDialog
          ? (type: string, branches: string[]) =>
              onOpenDialog({
                type,
                source: { type: "wsl", distro, projectPath: project.path },
                branches,
              })
          : undefined,
      [onOpenDialog, distro, project.path],
    );

    const handleRefreshGit = useCallback(() => {
      onRefreshGit?.(distro, project.id, project.path);
    }, [onRefreshGit, distro, project.id, project.path]);

    const handleGetWorktreeChangedFiles = useCallback(
      (worktreePath: string) =>
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke<FileChange[]>("wsl_get_worktree_changed_files", { distro, worktreePath })
        ),
      [distro],
    );

    const handleIsWorktreeDirty = useCallback(
      (worktreePath: string) =>
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke<boolean>("wsl_is_worktree_dirty", { distro, worktreePath })
        ),
      [distro],
    );

    return (
      <ProjectItemCard
        project={project}
        isActive={isActive}
        hasSession={hasSession}
        onSelectProject={() => onSelectProject(distro, project)}
        onSelectFile={handleSelectFile}
        onCheckoutBranch={handleCheckout}
        onCommitRenameBranch={handleRenameBranch}
        onOpenWorktreeTerminal={handleOpenWorktree}
        onCommitRenameWorktree={handleRenameWorktree}
        onRemoveWorktree={handleRemoveWorktree}
        onRemoveProject={handleRemove}
        onOpenIde={handleOpenIde}
        onOpenDialog={handleOpenDialog}
        currentBranch={project.git_info?.current_branch ?? ""}
        ideCommandOverrides={ideCommandOverrides}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        agents={agents}
        config={config}
        onSaveProjectSettings={onSaveProjectSettings}
        onRefreshGit={handleRefreshGit}
        onShowToast={onShowToast}
        onGetWorktreeChangedFiles={handleGetWorktreeChangedFiles}
        onIsWorktreeDirty={handleIsWorktreeDirty}
      />
    );
  },
);

WSLProjectCard.displayName = "WSLProjectCard";

export default WSLProjectCard;
