/**
 * @deprecated Use `useProjectActions({ environment: "wsl", ... })` from `features/project/hooks/useProjectActions` instead.
 * This is a thin wrapper for backwards compatibility.
 */
import type { SaveSessionFn } from '@/shared/hooks/useConnectionProjects';
import { useProjectActions } from '@/shared/hooks/useProjectActions';
import type { AppConfig } from '@/shared/types';

interface DeprecatedUseWslActionsParams {
  config: AppConfig;
  showToast: (message: string, type?: 'info' | 'error') => void;
  saveSession: SaveSessionFn;
}

export function useWslActions({ config, showToast, saveSession }: DeprecatedUseWslActionsParams) {
  return useProjectActions({ environment: 'wsl', config, showToast, saveSession });
}
