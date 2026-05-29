/**
 * useActiveProject — 统一 Active Project Context 主 Hook
 *
 * 约束 H2：只负责「读取 store → 构建 context」，不包含副作用（无 useEffect，无 setState）。
 * 约束 L2：返回值供面板组件使用，面板不需要直接访问 appStore。
 */

import { useMemo } from "react";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import type { ActiveProjectContext } from "@/types/activeProject";
import { getCapabilities } from "./capabilities";
import { toLocalUnifiedView, toWslUnifiedView, toRemoteUnifiedView } from "./adapters";
import { createUnifiedCommands } from "./commandFactory";
import type { GitTransportKind } from "./commandFactory";

/**
 * useActiveProject — 读取 store 中三种活跃项目状态，构建统一 ActiveProjectContext
 *
 * 优先级：remote > wsl > local
 * 所有字段在 project 为 null 时返回 null，不抛出异常。
 *
 * @returns ActiveProjectContext
 */
export function useActiveProject(): ActiveProjectContext {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWslProject = useConnectionStore((s) => s.activeWslProject);
  const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWslWorktreePath = useWorktreeStore((s) => s.activeWslWorktreePath);
  const activeRemoteWorktreePath = useWorktreeStore((s) => s.activeRemoteWorktreePath);
  const remoteAuthStore = useConnectionStore((s) => s.remoteAuthStore);

  const commands = useMemo(() => {
    if (activeRemoteProject !== null) {
      const { entry, project } = activeRemoteProject;
      const authKey = entry.id;
      const savedAuth = remoteAuthStore.get(authKey);
      if (savedAuth === undefined) return null;
      const transport: GitTransportKind = {
        type: "Remote",
        host: entry.host,
        port: entry.port,
        username: entry.username,
        auth: savedAuth,
        projectPath: project.path,
      };
      return createUnifiedCommands(transport);
    }
    if (activeWslProject !== null) {
      const transport: GitTransportKind = {
        type: "Wsl",
        distro: activeWslProject.distro,
        projectPath: activeWslProject.project.path,
      };
      return createUnifiedCommands(transport);
    }
    if (activeProject !== null) {
      const transport: GitTransportKind = {
        type: "Local",
        projectId: activeProject.id,
        projectPath: activeProject.path,
      };
      return createUnifiedCommands(transport);
    }
    return null;
  }, [
    activeProject?.id,
    activeProject?.path,
    activeWslProject?.distro,
    activeWslProject?.project.path,
    activeRemoteProject?.entry.id,
    activeRemoteProject?.entry.host,
    activeRemoteProject?.entry.port,
    activeRemoteProject?.entry.username,
    activeRemoteProject?.project.path,
    remoteAuthStore,
  ]);

  return useMemo((): ActiveProjectContext => {
    if (activeRemoteProject !== null) {
      const { entry, project } = activeRemoteProject;

      if (commands === null) {
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
        auth: remoteAuthStore.get(entry.id)!,
        projectPath: project.path,
      };

      return {
        project: toRemoteUnifiedView(entry, project),
        commands,
        capabilities: getCapabilities("remote"),
        connectionContext,
        worktreePath: activeRemoteWorktreePath,
        isLoading: false,
      };
    }

    if (activeWslProject !== null) {
      const { distro, project } = activeWslProject;

      const connectionContext = {
        type: "wsl" as const,
        distro,
        projectPath: project.path,
      };

      return {
        project: toWslUnifiedView(distro, project),
        commands,
        capabilities: getCapabilities("wsl"),
        connectionContext,
        worktreePath: activeWslWorktreePath,
        isLoading: false,
      };
    }

    if (activeProject !== null) {
      const connectionContext = {
        type: "local" as const,
        projectId: activeProject.id,
      };

      return {
        project: toLocalUnifiedView(activeProject),
        commands,
        capabilities: getCapabilities("local"),
        connectionContext,
        worktreePath: activeWorktreePath,
        isLoading: false,
      };
    }

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
    commands,
  ]);
}
