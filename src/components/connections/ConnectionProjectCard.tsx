import React, { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import ProjectItemCard from "./ProjectItemCard";
import type { ConnectionProjectCardProps } from "./types";
import type { FileChange } from "../../types";

const LOG_TAG: Record<string, string> = {
  wsl: "[WSL]",
  remote: "[SSH]",
};

const ConnectionProjectCard: React.FC<ConnectionProjectCardProps> = React.memo(
  ({
    project,
    entryId,
    source,
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
    // Extract primitives for stable useCallback dependencies
    const isWsl = source.type === "wsl";
    const distro = source.type === "wsl" ? source.distro : "";
    const remoteEntryId = source.type === "remote" ? source.entryId : "";
    const host = source.type === "remote" ? source.host : "";
    const remoteInvoke = source.type === "remote" ? source.invokeRemoteGit : undefined;
    const logTag = LOG_TAG[source.type] ?? "";

    // connectionId: scope identifier used for most callbacks
    const connectionId = isWsl ? distro : remoteEntryId;
    // selectProjectId: scope identifier for onSelectProject (WSL uses distro, Remote uses host)
    const selectProjectId = isWsl ? distro : host;

    const handleSelectFile = useCallback(
      (fp: string) => {
        onSelectFile?.(connectionId, project.path, fp);
      },
      [onSelectFile, connectionId, project.path],
    );

    const handleCheckout = useCallback(
      (branch: string): Promise<void> => {
        if (isWsl) {
          return invoke("wsl_checkout_branch", {
            distro,
            projectPath: project.path,
            branchName: branch,
          }).then(
            () => onRefreshGit?.(connectionId, project.id, project.path) ?? Promise.resolve(),
          );
        }
        if (remoteInvoke) {
          return remoteInvoke("remote_checkout_branch", remoteEntryId, {
            projectPath: project.path,
            branchName: branch,
          }).then(
            () => onRefreshGit?.(connectionId, project.id, project.path) ?? Promise.resolve(),
          );
        }
        return Promise.resolve();
      },
      [isWsl, distro, project.path, connectionId, project.id, onRefreshGit, remoteInvoke, remoteEntryId],
    );

    const handleRenameBranch = useCallback(
      (oldName: string, newName: string) => {
        if (isWsl) {
          invoke("wsl_rename_branch", {
            distro,
            projectPath: project.path,
            oldName,
            newName,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch(console.error);
        } else if (remoteInvoke) {
          remoteInvoke("remote_rename_branch", remoteEntryId, {
            projectPath: project.path,
            oldName,
            newName,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch(console.error);
        }
      },
      [isWsl, distro, project.path, connectionId, project.id, onRefreshGit, remoteInvoke, remoteEntryId],
    );

    const handleOpenWorktree = useCallback(
      (wtPath: string, branch: string) => {
        onOpenWorktreeTerminal?.(connectionId, wtPath, branch);
      },
      [onOpenWorktreeTerminal, connectionId],
    );

    const handleRenameWorktree = useCallback(
      (oldPath: string, newName: string) => {
        if (isWsl) {
          invoke("wsl_rename_worktree", {
            distro,
            projectPath: project.path,
            worktreePath: oldPath,
            newName,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch(console.error);
        } else if (remoteInvoke) {
          remoteInvoke("remote_rename_worktree", remoteEntryId, {
            projectPath: project.path,
            worktreePath: oldPath,
            newName,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch(console.error);
        }
      },
      [isWsl, distro, project.path, connectionId, project.id, onRefreshGit, remoteInvoke, remoteEntryId],
    );

    const handleRemoveWorktree = useCallback(
      (wtPath: string, _branch: string) => {
        if (isWsl) {
          invoke("wsl_remove_worktree", {
            distro,
            projectPath: project.path,
            worktreePath: wtPath,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch((e: unknown) => {
              console.error(`${logTag} Failed to remove worktree:`, e);
            });
        } else if (remoteInvoke) {
          remoteInvoke("remote_remove_worktree", remoteEntryId, {
            projectPath: project.path,
            worktreePath: wtPath,
          })
            .then(() => onRefreshGit?.(connectionId, project.id, project.path))
            .catch((e: unknown) => {
              console.error(`${logTag} Failed to remove worktree:`, e);
            });
        }
      },
      [isWsl, distro, project.path, connectionId, project.id, onRefreshGit, remoteInvoke, remoteEntryId, logTag],
    );

    const handleRemove = useCallback(() => {
      onRemoveProject(entryId, project.id);
    }, [onRemoveProject, entryId, project.id]);

    const handleOpenIde = useMemo(
      () =>
        onOpenIde
          ? () => onOpenIde(connectionId, project.path, project.selected_ide ?? "")
          : undefined,
      [onOpenIde, connectionId, project.path, project.selected_ide],
    );

    const handleOpenDialog = useMemo(
      () =>
        onOpenDialog
          ? (type: string, branches: string[]) =>
              onOpenDialog({
                type,
                source: isWsl
                  ? { type: "wsl", distro, projectPath: project.path }
                  : { type: "remote", entryId: remoteEntryId, projectPath: project.path },
                branches,
              })
          : undefined,
      [onOpenDialog, isWsl, distro, remoteEntryId, project.path],
    );

    const handleRefreshGit = useCallback(() => {
      onRefreshGit?.(connectionId, project.id, project.path);
    }, [onRefreshGit, connectionId, project.id, project.path]);

    const handleGetWorktreeChangedFiles = useCallback(
      (worktreePath: string): Promise<FileChange[]> => {
        if (isWsl) {
          return invoke<FileChange[]>("wsl_get_worktree_changed_files", {
            distro,
            worktreePath,
          });
        }
        if (remoteInvoke) {
          return remoteInvoke("remote_get_worktree_changed_files", remoteEntryId, {
            worktreePath,
          }).then((r) => r as FileChange[]);
        }
        return Promise.resolve([] as FileChange[]);
      },
      [isWsl, distro, remoteInvoke, remoteEntryId],
    );

    const handleIsWorktreeDirty = useCallback(
      (worktreePath: string): Promise<boolean> => {
        if (isWsl) {
          return invoke<boolean>("wsl_is_worktree_dirty", { distro, worktreePath });
        }
        if (remoteInvoke) {
          return remoteInvoke("remote_is_worktree_dirty", remoteEntryId, {
            worktreePath,
          }).then((r) => r as boolean);
        }
        return Promise.resolve(false);
      },
      [isWsl, distro, remoteInvoke, remoteEntryId],
    );

    return (
      <ProjectItemCard
        project={project}
        isActive={isActive}
        hasSession={hasSession}
        onSelectProject={() => onSelectProject(selectProjectId, project)}
        onToggleCollapsed={() => {}}
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

ConnectionProjectCard.displayName = "ConnectionProjectCard";

export default ConnectionProjectCard;
