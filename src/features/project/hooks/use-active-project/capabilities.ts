import type { ProjectEnvironment } from '@/shared/types/project';
import type { ProjectCapabilities } from '@/shared/types/activeProject';

const CAPABILITIES_MAP: Record<ProjectEnvironment['type'], ProjectCapabilities> = {
  Local: {
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
  },
  Wsl: {
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
  },
  Remote: {
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
  },
};

export function getCapabilities(type: ProjectEnvironment['type']): ProjectCapabilities {
  return CAPABILITIES_MAP[type];
}
