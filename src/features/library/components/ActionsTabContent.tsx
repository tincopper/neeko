import React, { useCallback, useEffect } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import type { ActionResource } from '@/shared/types/library';

import ActionEditorDialog from './ActionEditorDialog';
import ActionListSection from './ActionListSection';

/**
 * Container for the Actions tab — combines the action list with the editor
 * dialog and wires up run/edit/delete actions.
 */
const ActionsTabContent: React.FC = React.memo(() => {
  const refreshActions = useLibraryStore((s) => s.refreshActions);
  const executeAction = useLibraryStore((s) => s.executeAction);
  const openActionEditor = useLibraryStore((s) => s.openActionEditor);

  useEffect(() => {
    void refreshActions();
  }, [refreshActions]);

  const handleRun = useCallback(
    (action: ActionResource) => {
      void executeAction(action.id);
    },
    [executeAction],
  );

  const handleEdit = useCallback(
    (action: ActionResource) => {
      openActionEditor(action);
    },
    [openActionEditor],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
      <ActionListSection onRun={handleRun} onEdit={handleEdit} />
      <ActionEditorDialog />
    </div>
  );
});

ActionsTabContent.displayName = 'ActionsTabContent';

export default ActionsTabContent;
