import type { Project } from '@/shared/types/project';
import type { ProjectView } from '@/shared/types/activeProject';

/**
 * Convert unified Project to ProjectView (all environments — local, WSL, remote).
 * The unified Project already carries environment info via its `environment` field.
 */
export function toLocalView(project: Project): ProjectView {
  return {
    type: project.environment.type,
    id: project.id,
    name: project.name,
    path: project.path,
    gitInfo: project.git_info ?? null,
    selectedAgent: project.selected_agents,
    selectedIde: project.selected_ide,
  };
}
