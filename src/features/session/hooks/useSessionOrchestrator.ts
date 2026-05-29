import { useSessionBootstrap } from "@/features/session/hooks/useSessionBootstrap";
import { useSessionPersistence } from "@/features/session/hooks/useSessionPersistence";
import type { WSLEntrySession, RemoteEntrySession } from "@/types/connection";
import type { SaveSessionFn } from "@/features/connection/hooks/useWslProjects";

export interface UseSessionOrchestratorResult {
  saveSession: SaveSessionFn;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
  restoreWorktreeState: (next: Record<string, string>) => void;
}

interface UseSessionOrchestratorParams {
  loadProjects: () => Promise<void>;
  setWslEntries: React.Dispatch<React.SetStateAction<WSLEntrySession[]>>;
  setRemoteEntries: React.Dispatch<React.SetStateAction<RemoteEntrySession[]>>;
  restoreAuthFromEntries: (entries: RemoteEntrySession[]) => void;
}

export function useSessionOrchestrator({
  loadProjects, setWslEntries, setRemoteEntries, restoreAuthFromEntries,
}: UseSessionOrchestratorParams): UseSessionOrchestratorResult {
  const session = useSessionPersistence();

  useSessionBootstrap({
    loadProjects,
    setWslEntries,
    setRemoteEntries,
    restoreWorktreeState: session.restoreWorktreeState,
    restoreAuthFromEntries,
  });

  return {
    saveSession: session.saveSession,
    saveWorktreeState: session.saveWorktreeState,
    restoreWorktreeState: session.restoreWorktreeState,
  };
}
