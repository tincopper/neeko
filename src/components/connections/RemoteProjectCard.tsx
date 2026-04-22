import React, { useCallback, useMemo } from "react";
import ProjectItemCard from "./ProjectItemCard";
import type { RemoteProjectCardProps } from "./types";

const RemoteProjectCard: React.FC<RemoteProjectCardProps> = React.memo(
  ({
    project,
    entryId,
    host,
    isActive,
    hasSession,
    onSelectProject,
    onRemoveProject,
    onSelectFile,
    onRefreshGit,
    onOpenIde,
    onOpenWorktreeTerminal,
    invokeRemoteGit,
    onOpenDialog,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
  }) => {
    const handleSelectFile = useCallback(
      (fp: string) => {
        onSelectFile?.(entryId, project.path, fp);
      },
      [onSelectFile, entryId, project.path],
    );

    const handleCheckout = useCallback(
      (branch: string) => {
        if (invokeRemoteGit) {
          invokeRemoteGit("remote_checkout_branch", entryId, {
            projectPath: project.path,
            branchName: branch,
          }).then(() => onRefreshGit?.(entryId, project.id, project.path));
        }
      },
      [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit],
    );

    const handleRenameBranch = useCallback(
      (oldName: string, newName: string) => {
        if (invokeRemoteGit) {
          invokeRemoteGit("remote_rename_branch", entryId, {
            projectPath: project.path,
            oldName,
            newName,
          })
            .then(() => onRefreshGit?.(entryId, project.id, project.path))
            .catch(console.error);
        }
      },
      [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit],
    );

    const handleOpenWorktree = useCallback(
      (wtPath: string, branch: string) => {
        onOpenWorktreeTerminal?.(entryId, wtPath, branch);
      },
      [onOpenWorktreeTerminal, entryId],
    );

    const handleRenameWorktree = useCallback(
      (oldPath: string, newName: string) => {
        if (invokeRemoteGit) {
          invokeRemoteGit("remote_rename_worktree", entryId, {
            projectPath: project.path,
            worktreePath: oldPath,
            newName,
          })
            .then(() => onRefreshGit?.(entryId, project.id, project.path))
            .catch(console.error);
        }
      },
      [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit],
    );

    const handleRemoveWorktree = useCallback(
      (wtPath: string, _branch: string) => {
        if (invokeRemoteGit) {
          invokeRemoteGit("remote_remove_worktree", entryId, {
            projectPath: project.path,
            worktreePath: wtPath,
          })
            .then(() => onRefreshGit?.(entryId, project.id, project.path))
            .catch((e: unknown) => {
              console.error("[SSH] Failed to remove worktree:", e);
            });
        }
      },
      [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit],
    );

    const handleRemove = useCallback(() => {
      onRemoveProject(entryId, project.id);
    }, [onRemoveProject, entryId, project.id]);

    const handleOpenIde = useMemo(
      () =>
        onOpenIde
          ? () => onOpenIde(entryId, project.path, project.selected_ide ?? "")
          : undefined,
      [onOpenIde, entryId, project.path, project.selected_ide],
    );

    const handleOpenDialog = useMemo(
      () =>
        onOpenDialog
          ? (type: string, branches: string[]) =>
              onOpenDialog({
                type,
                source: { type: "remote", entryId, projectPath: project.path },
                branches,
              })
          : undefined,
      [onOpenDialog, entryId, project.path],
    );

    return (
      <ProjectItemCard
        project={project}
        isActive={isActive}
        hasSession={hasSession}
        onSelectProject={() => onSelectProject(host, project)}
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
      />
    );
  },
);

RemoteProjectCard.displayName = "RemoteProjectCard";

export default RemoteProjectCard;
