import type { Project } from '@/shared/types/project';
import type { WSLProject, RemoteProject, RemoteEntrySession } from '@/shared/types/connection';
import type { ProjectView } from '@/shared/types/activeProject';

export function toLocalView(project: Project): ProjectView {
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

export function toWslView(distro: string, project: WSLProject): ProjectView {
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

export function toRemoteView(
  entry: RemoteEntrySession,
  project: RemoteProject,
): ProjectView {
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
