/**
 * @deprecated Use `useConnectionProjects({ environment: "remote", saveSession, showToast })` from `features/project/hooks/useConnectionProjects` instead.
 * This is a thin wrapper for backwards compatibility.
 */
import { useConnectionProjects } from "@/features/project/hooks/useConnectionProjects";
import type { SaveSessionFn } from "@/features/project/hooks/useConnectionProjects";

export function useRemoteProjects(
  saveSession: SaveSessionFn,
  showToast: (message: string, type?: "info" | "error") => void,
) {
  return useConnectionProjects({ environment: "remote", saveSession, showToast });
}
