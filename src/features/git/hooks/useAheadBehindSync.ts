import { useEffect } from "react";
import type { AheadBehind } from '@/shared/types';
import { useProjectStore } from '@/features/project/store';
import { useGitStore } from '@/features/git/store';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';

interface AheadBehindCommands {
  getAheadBehind(): Promise<AheadBehind>;
}

/**
 * useAheadBehindSync - when the active project changes, fetch ahead/behind counts.
 *
 * Reads from unified Project store; WSL/remote are resolved via
 * activeProject.environment.
 */
export function useAheadBehindSync(commands?: AheadBehindCommands | null) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setAheadBehind = useGitStore((s) => s.setAheadBehind);

  useEffect(() => {
    if (!commands || !activeProjectId || !activeProject) return;

    const env = activeProject.environment;
    const kind = env.type === "Local" ? "local" : env.type === "Wsl" ? "wsl" : "remote";
    const entryId = env.type === "Wsl" ? env.distro
      : env.type === "Remote" ? `${env.host}:${env.port}`
      : activeProjectId;
    const key = aheadBehindKey(kind, entryId, activeProjectId);

    let cancelled = false;
    commands.getAheadBehind()
      .then((info) => {
        if (!cancelled) setAheadBehind(key, info);
      })
      .catch(() => {
        if (!cancelled) setAheadBehind(key, null);
      });
    return () => { cancelled = true; };
  }, [activeProjectId, activeProject, commands, setAheadBehind]);
}
