import { useMemo } from "react";
import { IS_WINDOWS } from '@/shared/utils/platform';
import { useProjectStore } from '@/features/project/store';
import { useConnectionStore } from '@/features/connection/store';

export interface ProjectListItem {
  kind: "local" | "wsl" | "remote";
  id: string;
  name: string;
  path: string;
  has_git_info: boolean;
  selected_agent?: string | null;
  distro?: string;
  entryId?: string;
  host?: string;
  isLast: boolean;
  isFirstInSection: boolean;
}

export function useProjectList(): {
  items: ProjectListItem[];
  isEmpty: boolean;
} {
  const projects = useProjectStore((state) => state.projects);
  const wslEntries = useConnectionStore((state) => state.wslEntries);
  const remoteEntries = useConnectionStore((state) => state.remoteEntries);

  return useProjectListFromData(projects, wslEntries, remoteEntries);
}

/** Pure function version â€?testable without React context */
export function useProjectListFromData(
  projects: { id: string; name: string; path: string; git_info?: unknown | null; selected_agent?: string | null }[],
  wslEntries: { id: string; distro: string; projects: { id: string; name: string; path: string; git_info?: unknown | null; selected_agent?: string | null }[] }[],
  remoteEntries: { id: string; host: string; projects: { id: string; name: string; path: string; git_info?: unknown | null; selected_agent?: string | null }[] }[],
): { items: ProjectListItem[]; isEmpty: boolean } {
  return useMemo(() => {
    const items: ProjectListItem[] = [];

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
