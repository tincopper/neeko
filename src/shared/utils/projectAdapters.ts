import type { WSLProject, RemoteProject } from '@/shared/types/connection';
import type { Project } from '@/shared/types/project';

export function projectToWslProject(p: Project, distro: string): WSLProject {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    distro,
    entry_id: p.id,
    selected_agents: p.selected_agents,
    selected_ide: p.selected_ide,
    git_info: p.git_info,
    avatar_color: p.avatar_color,
  };
}

export function projectToRemoteProject(p: Project): RemoteProject {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    entry_id: p.id,
    selected_agents: p.selected_agents,
    selected_ide: p.selected_ide,
    git_info: p.git_info,
    avatar_color: p.avatar_color,
  };
}
