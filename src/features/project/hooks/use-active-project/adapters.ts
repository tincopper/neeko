import type { Project } from '@/shared/types/project';
import type { ProjectView } from '@/shared/types/activeProject';

const ENV_TYPE_TO_VIEW_TYPE: Record<string, "local" | "wsl" | "remote"> = {
  Local: "local",
  Wsl: "wsl",
  Remote: "remote",
};

/**
 * Convert unified Project to ProjectView (all environments — local, WSL, remote).
 * The unified Project already carries environment info via its `environment` field.
 */
export function toLocalView(project: Project): ProjectView {
  return {
    type: ENV_TYPE_TO_VIEW_TYPE[project.environment.type] ?? "local",
    id: project.id,
    name: project.name,
    path: project.path,
    gitInfo: project.git_info ?? null,
    selectedAgent: project.selected_agent,
    selectedIde: project.selected_ide,
  };
}
