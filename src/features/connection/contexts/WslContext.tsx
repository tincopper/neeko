/**
 * @deprecated Use ConnectionProjectContext from features/project/contexts instead.
 * This file re-exports from the unified ConnectionProjectContext for backwards compatibility.
 */
import {
  ConnectionProjectProvider,
  useConnectionProjectContext,
} from "@/features/project/contexts/ConnectionProjectContext";
import type { WslContextValue } from "@/features/project/contexts/ConnectionProjectContext";

// Re-export the provider with the old name for backwards compatibility
export const WslProvider = ConnectionProjectProvider;

/**
 * @deprecated Use useConnectionProjectContext instead.
 */
export function useWslContext(): WslContextValue {
  return useConnectionProjectContext();
}

export type { WslContextValue };
