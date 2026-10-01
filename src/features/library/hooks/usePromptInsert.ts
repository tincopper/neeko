import { useCallback } from 'react';

import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';

import { useLibraryStore } from '../store/libraryStore';

/**
 * Prompt insert flow shared by LibraryPanel and LibraryDetail (single source).
 * Resolves `{{variables}}` through the variable dialog for agent and terminal
 * inserts, then forwards the (possibly rendered) prompt to the host callback.
 * Usage is counted only when the prompt is actually inserted (dialog confirmed
 * or variable-free direct insert) — cancelling the dialog counts nothing.
 */
export function usePromptInsert(
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void,
) {
  const recordUsage = useLibraryStore((s) => s.recordUsage);

  return useCallback(
    (prompt: PromptResource, target: PromptInsertTarget = 'agent') => {
      if (target === 'agent' || target === 'terminal') {
        const variables = useLibraryStore.getState().detectVariables(prompt.content);
        if (variables.length > 0) {
          void useLibraryStore
            .getState()
            .openVariableDialog(prompt.content)
            .then((rendered) => {
              // null = 取消 / 关闭 / 无宿主：没有拿到可用文本，不插入也不计次数。
              if (rendered === null) return;
              void recordUsage(prompt.id);
              onInsertPrompt?.({ ...prompt, content: rendered }, target);
            });
          return;
        }
      }
      void recordUsage(prompt.id);
      onInsertPrompt?.(prompt, target);
    },
    [recordUsage, onInsertPrompt],
  );
}
