/**
 * @deprecated Use `useConnectionProjects({ environment: "wsl", saveSession })` from `features/project/hooks/useConnectionProjects` instead.
 * This is a thin wrapper for backwards compatibility.
 */
import { useConnectionProjects } from "@/features/project/hooks/useConnectionProjects";
import type { SaveSessionFn } from "@/features/project/hooks/useConnectionProjects";

export type { SaveSessionFn } from "@/features/project/hooks/useConnectionProjects";

export function useWslProjects(saveSession: SaveSessionFn) {
  return useConnectionProjects({ environment: "wsl", saveSession });
}
