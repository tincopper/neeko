import type { ProjectType, ProjectCapabilities } from '@/shared/types/activeProject";

export function getCapabilities(type: ProjectType): ProjectCapabilities {
  switch (type) {
    case "local":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        canEditFiles: true,
        canGenerateCommitMessage: true,
        canManagePRs: true,
      };

    case "wsl":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        canEditFiles: false,
        canGenerateCommitMessage: true,
        canManagePRs: false,
      };

    case "remote":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        canEditFiles: false,
        canGenerateCommitMessage: true,
        canManagePRs: false,
      };

    default:
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        canEditFiles: true,
        canGenerateCommitMessage: true,
        canManagePRs: true,
      };
  }
}
