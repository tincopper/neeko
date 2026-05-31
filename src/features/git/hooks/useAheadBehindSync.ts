import { useEffect } from "react";
import type { AheadBehind } from '@/shared/types';
import { useProjectStore } from '@/features/project/store';
import { useConnectionStore } from '@/features/connection/store';
import { useGitStore } from '@/features/git/store';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';

interface AheadBehindCommands {
  getAheadBehind(): Promise<AheadBehind>;
}

/**
 * useAheadBehindSync â€?when the active project changes, fetch ahead/behind counts.
 *
 * If `commands` is provided (from use-active-project), uses the unified transport.
 * Otherwise falls back to legacy manual invoke (not used in new code).
 */
export function useAheadBehindSync(commands?: AheadBehindCommands | null) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWslProject = useConnectionStore((s) => s.activeWslProject);
  const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
  const setAheadBehind = useGitStore((s) => s.setAheadBehind);

  useEffect(() => {
    if (!commands) return;
    if (!activeProjectId && !activeWslProject && !activeRemoteProject) return;

    const id = (activeProjectId ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id)!;
    const kind = (activeProjectId ? "local" : activeWslProject ? "wsl" : "remote") as "local" | "wsl" | "remote";
    const entryId = activeWslProject?.distro ?? activeRemoteProject?.entry.id ?? id;
    const key = aheadBehindKey(kind, entryId, id);

    let cancelled = false;
    commands.getAheadBehind()
      .then((info) => {
        if (!cancelled) setAheadBehind(key, info);
      })
      .catch(() => {
        if (!cancelled) setAheadBehind(key, null);
      });
    return () => { cancelled = true; };
  }, [activeProjectId, activeWslProject, activeRemoteProject, commands, setAheadBehind]);
}
