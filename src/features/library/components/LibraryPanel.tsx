import React, { useCallback, useEffect } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';

import LibraryActivityBar from './LibraryActivityBar';
import LibraryDetail from './LibraryDetail';
import LibraryNavTree from './LibraryNavTree';
import PromptEditorDialog from './PromptEditorDialog';
import PromptInsertDialog from './PromptInsertDialog';
import VariableDialog from './VariableDialog';

interface LibraryPanelProps {
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = React.memo(({ onInsertPrompt }) => {
  const refreshPrompts = useLibraryStore((s) => s.refreshPrompts);
  const recordUsage = useLibraryStore((s) => s.recordUsage);
  const refreshActions = useLibraryStore((s) => s.refreshActions);
  const variableDialogOpen = useLibraryStore((s) => s.variableDialogOpen);
  const variableDialogContent = useLibraryStore((s) => s.variableDialogContent);
  const variableDialogResolve = useLibraryStore((s) => s.variableDialogResolve);
  const closeVariableDialog = useLibraryStore((s) => s.closeVariableDialog);

  useEffect(() => {
    void refreshPrompts();
    void refreshActions();
  }, [refreshPrompts, refreshActions]);

  const handleInsert = useCallback(
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

  const handleVariableConfirm = useCallback(
    (rendered: string) => {
      variableDialogResolve?.(rendered);
      closeVariableDialog();
    },
    [variableDialogResolve, closeVariableDialog],
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
      <div className="flex-1 min-h-0 flex gap-0.5 p-0.5">
        <div className="flex flex-col shrink-0 w-60 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
          <LibraryActivityBar />
          <LibraryNavTree />
        </div>
        <div className="flex-1 min-w-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
          <LibraryDetail onInsertPrompt={onInsertPrompt} />
        </div>
      </div>
      <PromptEditorDialog />
      <PromptInsertDialog onInsert={handleInsert} />
      {variableDialogOpen && variableDialogContent && (
        <VariableDialog
          content={variableDialogContent}
          onConfirm={handleVariableConfirm}
          onCancel={closeVariableDialog}
        />
      )}
    </div>
  );
});

LibraryPanel.displayName = 'LibraryPanel';

export default LibraryPanel;
