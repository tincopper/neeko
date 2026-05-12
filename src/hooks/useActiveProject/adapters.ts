/**
 * adapters.ts — 将三种原始项目类型转为 UnifiedProjectView 的适配器
 */

import type { Project } from "../../types/project";
import type { WSLProject, RemoteProject, RemoteEntrySession } from "../../types/connection";
import type { UnifiedProjectView } from "../../types/activeProject";

/**
 * toLocalUnifiedView — 将本地 Project 转为统一视图
 */
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

/**
 * toWslUnifiedView — 将 WSL 项目转为统一视图
 * id 格式：`wsl:{distro}:{path}`
 */
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

/**
 * toRemoteUnifiedView — 将 Remote 项目转为统一视图
 * id 格式：`remote:{host}:{path}`
 */
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
