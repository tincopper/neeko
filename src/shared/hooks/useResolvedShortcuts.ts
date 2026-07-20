/**
 * Subscribe to user shortcut overrides and resolve against registry defaults.
 * Prefer this over reading config.shortcuts raw strings in UI components.
 */
import { useMemo } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';
import {
  getResolvedBinding,
  resolveBindings,
  toCodeMirrorKey,
} from '@/shared/utils/shortcutRegistry';

export function useResolvedShortcuts(): Record<string, string> {
  const { config } = useAppContext();
  return useMemo(() => resolveBindings(config.shortcuts ?? {}), [config.shortcuts]);
}

export function useResolvedBinding(actionId: string): string {
  const { config } = useAppContext();
  return useMemo(
    () => getResolvedBinding(actionId, config.shortcuts),
    [actionId, config.shortcuts],
  );
}

/** CodeMirror keymap key for a configurable action. */
export function useCodeMirrorBinding(actionId: string): string {
  const binding = useResolvedBinding(actionId);
  return useMemo(() => toCodeMirrorKey(binding), [binding]);
}
