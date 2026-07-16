/**
 * use-active-project — 统一 Active Project Context 主 Hook
 *
 * 约束 H2：只负责「读取 store → 构建 context」，不包含副作用（无 useEffect，无 setState）。
 * 约束 L2：返回值供面板组件使用，面板不需要直接访问 appStore。
 *
 * 从 unified Project store 读取活跃项目，不再区分 local/WSL/Remote 三个 store。
 */

import { useMemo } from "react";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import type { ActiveProjectContext } from '@/shared/types/activeProject';
import {
  environmentToConnectionContext,
} from '@/shared/types/project';
import { getCapabilities } from "./capabilities";
import { toLocalView } from "./adapters";
import { createProjectCommands } from "./commandFactory";

/**
 * use-active-project — 从 unified Project store 读取活跃项目，构建统一 ActiveProjectContext
 *
 * @returns ActiveProjectContext
 */
export function useActiveProject(): ActiveProjectContext {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);

  const commands = useMemo(() => {
    if (!activeProject) return null;
    return createProjectCommands(activeProject.id);
  }, [activeProject?.id]);

  return useMemo((): ActiveProjectContext => {
    if (!activeProject) {
      return {
        project: null,
        commands: null,
        capabilities: null,
        connectionContext: null,
        worktreePath: null,
        isLoading: false,
      };
    }

    const connectionContext = environmentToConnectionContext(
      activeProject.environment,
      activeProject.path,
      activeProject.id,
    );

    return {
      project: toLocalView(activeProject),
      commands,
      capabilities: getCapabilities(activeProject.environment.type),
      connectionContext,
      worktreePath: activeWorktreePath,
      isLoading: false,
    };
  }, [activeProject, activeWorktreePath, commands]);
}
