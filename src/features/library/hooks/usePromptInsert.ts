import { useCallback } from 'react';

import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';

import { useLibraryStore } from '../store/libraryStore';

/**
 * Prompt insert flow shared by LibraryPanel and LibraryDetail (single source).
 * Records usage, resolves `{{variables}}` through the variable dialog for agent
 * inserts, then forwards the (possibly rendered) prompt to the host callback.
 */
export function usePromptInsert(
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void,
) {
  const recordUsage = useLibraryStore((s) => s.recordUsage);

  return useCallback(
    (prompt: PromptResource, target: PromptInsertTarget = 'agent') => {
      void recordUsage(prompt.id);
      if (target === 'agent') {
        const variables = useLibraryStore.getState().detectVariables(prompt.content);
        if (variables.length > 0) {
          void useLibraryStore
            .getState()
            .openVariableDialog(prompt.content)
            .then((rendered) => {
              onInsertPrompt?.({ ...prompt, content: rendered }, target);
            });
          return;
        }
      }
      onInsertPrompt?.(prompt, target);
    },
    [recordUsage, onInsertPrompt],
  );
}
