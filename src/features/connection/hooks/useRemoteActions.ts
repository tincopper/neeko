/**
 * @deprecated Use `useProjectActions({ environment: "remote", ... })` from `features/project/hooks/useProjectActions` instead.
 * This is a thin wrapper for backwards compatibility.
 */
import type { SaveSessionFn } from '@/shared/hooks/useConnectionProjects';
import { useProjectActions } from '@/shared/hooks/useProjectActions';
import type { AppConfig } from '@/shared/types';

interface DeprecatedUseRemoteActionsParams {
  config: AppConfig;
  showToast: (message: string, type?: 'info' | 'error') => void;
  saveSession: SaveSessionFn;
}

export function useRemoteActions({
  config,
  showToast,
  saveSession,
}: DeprecatedUseRemoteActionsParams) {
  return useProjectActions({ environment: 'remote', config, showToast, saveSession });
}
