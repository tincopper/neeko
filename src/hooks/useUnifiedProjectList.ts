import { useMemo } from "react";
import { IS_WINDOWS } from "../utils/platform";
import { useProjectStore } from "../store/projectStore";
import { useWslContext } from "../contexts";
import { useRemoteContext } from "../contexts";

export interface UnifiedProjectItem {
  kind: "local" | "wsl" | "remote";
  id: string;
  name: string;
  path: string;
  has_git_info: boolean;
  selected_agent?: string | null;
  // WSL context
  distro?: string;
  entryId?: string;
  // Remote context
  host?: string;
  // Position: true only for the very last item across all sections
  isLast: boolean;
  // First item in its section (used to render section headers)
  isFirstInSection: boolean;
}

export function useUnifiedProjectList(): {
  items: UnifiedProjectItem[];
  isEmpty: boolean;
} {
  const projects = useProjectStore((state) => state.projects);
  const { wslEntries } = useWslContext();
  const { remoteEntries } = useRemoteContext();

  return useMemo(() => {
    const items: UnifiedProjectItem[] = [];

    // ── Local projects ──
    for (const p of projects) {
      items.push({
        kind: "local",
        id: p.id,
        name: p.name,
        path: p.path,
        has_git_info: !!p.git_info,
        selected_agent: p.selected_agent,
        isLast: false,
        isFirstInSection: items.length === 0 || items.every((i) => i.kind !== "local"),
      });
    }

    // ── WSL projects ──
    if (IS_WINDOWS) {
      for (const entry of wslEntries) {
        for (const p of entry.projects) {
          const isFirstInEntry = items.every(
            (i) => i.kind !== "wsl" || i.entryId !== entry.id,
          );
          items.push({
            kind: "wsl",
            id: p.id,
            name: p.name,
            path: p.path,
            has_git_info: !!p.git_info,
            selected_agent: p.selected_agent,
            distro: entry.distro,
            entryId: entry.id,
            isLast: false,
            isFirstInSection: isFirstInEntry,
          });
        }
      }
    }

    // ── Remote projects ──
    for (const entry of remoteEntries) {
      for (const p of entry.projects) {
        const isFirstInEntry = items.every(
          (i) => i.kind !== "remote" || i.entryId !== entry.id,
        );
        items.push({
          kind: "remote",
          id: p.id,
          name: p.name,
          path: p.path,
          has_git_info: !!p.git_info,
          selected_agent: p.selected_agent,
          host: entry.host,
          entryId: entry.id,
          isLast: false,
          isFirstInSection: isFirstInEntry,
        });
      }
    }

    if (items.length > 0) {
      items[items.length - 1].isLast = true;
    }

    return { items, isEmpty: items.length === 0 };
  }, [projects, wslEntries, remoteEntries]);
}
