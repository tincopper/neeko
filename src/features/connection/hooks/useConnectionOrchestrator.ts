import { useCallback } from "react";
import { useWslProjects } from "@/features/connection/hooks/useWslProjects";
import { useRemoteProjects } from "@/features/connection/hooks/useRemoteProjects";
import { useWslActions } from "@/features/connection/hooks/useWslActions";
import { useRemoteActions } from "@/features/connection/hooks/useRemoteActions";
import { useRemoteAuthActions } from "@/features/connection/hooks/useRemoteAuthActions";
import type { AppConfig } from "@/types/app";
import type { SaveSessionFn } from "@/features/connection/hooks/useWslProjects";

interface UseConnectionOrchestratorParams {
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}

export function useConnectionOrchestrator(params: UseConnectionOrchestratorParams) {
  const { config, showToast, saveSession } = params;
  const wsl = useWslProjects(saveSession);
  const remote = useRemoteProjects(saveSession, showToast);
  const remoteActions = useRemoteActions({ config, showToast, saveSession });
  const wslActions = useWslActions({ config, showToast, saveSession });
  const remoteAuthActions = useRemoteAuthActions({ saveSession });
  const handleWslDiffBack = useCallback(() => { wslActions.setWslDiffState(null); }, [wslActions.setWslDiffState]);
  return { wsl, remote, wslActions, remoteActions, remoteAuthActions, handleWslDiffBack };
}
