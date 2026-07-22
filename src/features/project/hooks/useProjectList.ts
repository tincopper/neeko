import { useMemo } from "react";
import { useProjectStore } from '@/features/project/store';
import type { ProjectEnvironment } from '@/shared/types';

export interface ProjectListItem {
  kind: "local" | "wsl" | "remote";
  id: string;
  name: string;
  path: string;
  has_git_info: boolean;
  selected_agents?: string[];
  distro?: string;
  entryId?: string;
  host?: string;
  isLast: boolean;
  isFirstInSection: boolean;
}

function isWslEnv(env: ProjectEnvironment): env is ProjectEnvironment & { type: "Wsl"; distro: string } {
  return env.type === "Wsl";
}

function isRemoteEnv(env: ProjectEnvironment): env is ProjectEnvironment & { type: "Remote"; host: string } {
  return env.type === "Remote";
}

const ENV_KIND: Record<string, "local" | "wsl" | "remote"> = {
  Local: "local",
  Wsl: "wsl",
  Remote: "remote",
};

export function useProjectList(): {
  items: ProjectListItem[];
  isEmpty: boolean;
} {
  const projects = useProjectStore((state) => state.projects);
  return useProjectListFromData(projects);
}

/** Pure function version — testable without React context */
export function useProjectListFromData(
  projects: { id: string; name: string; path: string; git_info?: unknown | null; selected_agents?: string[]; environment?: ProjectEnvironment }[],
): { items: ProjectListItem[]; isEmpty: boolean } {
  return useMemo(() => {
    const items: ProjectListItem[] = [];
    let prevKind: string | undefined;

    for (const p of projects) {
      const env = p.environment;
      const kind = env ? (ENV_KIND[env.type] ?? "local") : "local";

      items.push({
        kind,
        id: p.id,
        name: p.name,
        path: p.path,
        has_git_info: !!p.git_info,
        selected_agents: p.selected_agents,
        distro: env && isWslEnv(env) ? env.distro : undefined,
        host: env && isRemoteEnv(env) ? env.host : undefined,
        isLast: false,
        isFirstInSection: kind !== prevKind,
      });
      prevKind = kind;
    }

    if (items.length > 0) {
      items[items.length - 1].isLast = true;
    }

    return { items, isEmpty: items.length === 0 };
  }, [projects]);
}
