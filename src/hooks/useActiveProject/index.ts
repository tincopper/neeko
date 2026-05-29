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
import type { ActiveProjectContext } from "../../types/activeProject";
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
  // 从 store 读取三种活跃项目状态
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWslProject = useConnectionStore((s) => s.activeWslProject);
  const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWslWorktreePath = useWorktreeStore((s) => s.activeWslWorktreePath);
  const activeRemoteWorktreePath = useWorktreeStore((s) => s.activeRemoteWorktreePath);
  const remoteAuthStore = useConnectionStore((s) => s.remoteAuthStore);

  // 稳定 commands 引用：只依赖标量参数（id、path、host 等），
  // 不依赖整个 activeProject 对象引用。这样即使 git-changed 事件
  // 更新了 activeProject 引用，只要项目身份没变，commands 也保持稳定。
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
    // ── Remote 优先 ───────────────────────────────────────────────────────
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
        commands,
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
        commands,
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
    commands,
  ]);
}
