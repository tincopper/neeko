/**
 * useActiveProject — 统一 Active Project Context 主 Hook
 *
 * 约束 H2：只负责「读取 store → 构建 context」，不包含副作用（无 useEffect，无 setState）。
 * 约束 L2：返回值供面板组件使用，面板不需要直接访问 appStore。
 */

import { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import type { ActiveProjectContext } from "../../types/activeProject";
import { getCapabilities } from "./capabilities";
import { toLocalUnifiedView, toWslUnifiedView, toRemoteUnifiedView } from "./adapters";
import { createLocalCommands, createWslCommands, createRemoteCommands } from "./commandFactory";

/**
 * useActiveProject — 读取 store 中三种活跃项目状态，构建统一 ActiveProjectContext
 *
 * 优先级：remote > wsl > local
 * 所有字段在 project 为 null 时返回 null，不抛出异常。
 *
 * @returns ActiveProjectContext
 */
export function useActiveProject(): ActiveProjectContext {
  // 从 store 读取三种活跃项目状态
  const activeProject = useAppStore((s) => s.activeProject);
  const activeWslProject = useAppStore((s) => s.activeWslProject);
  const activeRemoteProject = useAppStore((s) => s.activeRemoteProject);
  const activeWorktreePath = useAppStore((s) => s.activeWorktreePath);
  const activeWslWorktreePath = useAppStore((s) => s.activeWslWorktreePath);
  const activeRemoteWorktreePath = useAppStore((s) => s.activeRemoteWorktreePath);
  const remoteAuthStore = useAppStore((s) => s.remoteAuthStore);

  return useMemo((): ActiveProjectContext => {
    // ── Remote 优先 ───────────────────────────────────────────────────────
    if (activeRemoteProject !== null) {
      const { entry, project } = activeRemoteProject;

      // 尝试从 auth store 获取已保存的认证方式
      const authKey = `${entry.host}:${entry.port}`;
      const savedAuth = remoteAuthStore.get(authKey);

      // 若无认证方式，无法构建命令集（安全考量）
      if (savedAuth === undefined) {
        return {
          project: toRemoteUnifiedView(entry, project),
          commands: null,
          capabilities: null,
          connectionContext: null,
          worktreePath: activeRemoteWorktreePath,
          isLoading: false,
        };
      }

      const connectionContext = {
        type: "remote" as const,
        host: entry.host,
        port: entry.port,
        username: entry.username,
        auth: savedAuth,
        projectPath: project.path,
      };

      return {
        project: toRemoteUnifiedView(entry, project),
        commands: createRemoteCommands(
          entry.host,
          entry.port,
          entry.username,
          savedAuth,
          project.path,
        ),
        capabilities: getCapabilities("remote"),
        connectionContext,
        worktreePath: activeRemoteWorktreePath,
        isLoading: false,
      };
    }

    // ── WSL 次优先 ────────────────────────────────────────────────────────
    if (activeWslProject !== null) {
      const { distro, project } = activeWslProject;

      const connectionContext = {
        type: "wsl" as const,
        distro,
        projectPath: project.path,
      };

      return {
        project: toWslUnifiedView(distro, project),
        commands: createWslCommands(distro, project.path),
        capabilities: getCapabilities("wsl"),
        connectionContext,
        worktreePath: activeWslWorktreePath,
        isLoading: false,
      };
    }

    // ── Local ─────────────────────────────────────────────────────────────
    if (activeProject !== null) {
      const connectionContext = {
        type: "local" as const,
        projectId: activeProject.id,
      };

      return {
        project: toLocalUnifiedView(activeProject),
        commands: createLocalCommands(activeProject.id),
        capabilities: getCapabilities("local"),
        connectionContext,
        worktreePath: activeWorktreePath,
        isLoading: false,
      };
    }

    // ── 无活跃项目 ────────────────────────────────────────────────────────
    return {
      project: null,
      commands: null,
      capabilities: null,
      connectionContext: null,
      worktreePath: null,
      isLoading: false,
    };
  }, [
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreePath,
    activeWslWorktreePath,
    activeRemoteWorktreePath,
    remoteAuthStore,
  ]);
}
