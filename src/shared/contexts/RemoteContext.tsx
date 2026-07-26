/**
 * @deprecated Use ConnectionProjectContext from shared/contexts instead.
 * This file re-exports from the unified ConnectionProjectContext for backwards compatibility.
 */
import {
  ConnectionProjectProvider,
  useConnectionProjectContext,
} from '@/shared/contexts/ConnectionProjectContext';
import type { RemoteContextValue } from '@/shared/contexts/ConnectionProjectContext';

// Re-export the provider with the old name for backwards compatibility
export const RemoteProvider = ConnectionProjectProvider;

/**
 * @deprecated Use useConnectionProjectContext instead.
 */
export function useRemoteContext(): RemoteContextValue {
  return useConnectionProjectContext();
}

export type { RemoteContextValue };
