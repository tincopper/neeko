import React, { useCallback, useEffect } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import type { McpServer } from '@/shared/types/mcpServer';

import McpEditorDialog from './McpEditorDialog';
import McpListSection from './McpListSection';

/**
 * Container for the MCP tab — combines the server list with the editor dialog.
 */
const McpTabContent: React.FC = React.memo(() => {
  const refreshMcpServers = useLibraryStore((s) => s.refreshMcpServers);
  const openMcpEditor = useLibraryStore((s) => s.openMcpEditor);

  useEffect(() => {
    void refreshMcpServers();
  }, [refreshMcpServers]);

  const handleEdit = useCallback(
    (server: McpServer) => {
      openMcpEditor(server);
    },
    [openMcpEditor],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
      <McpListSection onEdit={handleEdit} />
      <McpEditorDialog />
    </div>
  );
});

McpTabContent.displayName = 'McpTabContent';

export default McpTabContent;
