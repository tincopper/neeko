import type { Project } from '@/shared/types/project';
import type { WSLProject, RemoteProject, RemoteEntrySession } from '@/shared/types/connection';
import type { UnifiedProjectView } from '@/shared/types/activeProject';

export function toLocalUnifiedView(project: Project): UnifiedProjectView {
  return {
    type: "local",
    id: project.id,
    name: project.name,
    path: project.path,
    gitInfo: project.git_info ?? null,
    selectedAgent: project.selected_agent,
    selectedIde: project.selected_ide,
  };
}

export function toWslUnifiedView(distro: string, project: WSLProject): UnifiedProjectView {
  return {
    type: "wsl",
    id: `wsl:${distro}:${project.path}`,
    name: project.name,
    path: project.path,
    gitInfo: project.git_info ?? null,
    selectedAgent: project.selected_agent,
    selectedIde: project.selected_ide,
  };
}

export function toRemoteUnifiedView(
  entry: RemoteEntrySession,
  project: RemoteProject,
): UnifiedProjectView {
  return {
    type: "remote",
    id: `remote:${entry.host}:${project.path}`,
    name: project.name,
    path: project.path,
    gitInfo: project.git_info ?? null,
    selectedAgent: project.selected_agent,
    selectedIde: project.selected_ide,
  };
}
