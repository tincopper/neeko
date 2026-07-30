import React, { useCallback, useEffect } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import type { PromptResource } from '@/shared/types/library';

import CommandListSection from './CommandListSection';
import PromptEditorDialog from './PromptEditorDialog';

/**
 * Container for the Commands tab.
 *
 * Commands are prompts with kind='command'. They reuse the PromptEditorDialog
 * (which now supports a `kind` field) and the standard prompt CRUD commands.
 */
const CommandTabContent: React.FC = React.memo(() => {
  const refreshCommands = useLibraryStore((s) => s.refreshCommands);
  const openEditor = useLibraryStore((s) => s.openEditor);

  useEffect(() => {
    void refreshCommands();
  }, [refreshCommands]);

  const handleEdit = useCallback(
    (command: PromptResource) => {
      openEditor(command);
    },
    [openEditor],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
      <CommandListSection onEdit={handleEdit} />
      <PromptEditorDialog />
    </div>
  );
});

CommandTabContent.displayName = 'CommandTabContent';

export default CommandTabContent;
