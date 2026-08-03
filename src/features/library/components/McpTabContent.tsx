import React, { useCallback, useEffect } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import type { McpServer } from '@/shared/types/mcpServer';

import McpEditorDialog from './McpEditorDialog';
import McpInstallDialog from './McpInstallDialog';
import McpListSection from './McpListSection';
import McpMarketplaceContent from './McpMarketplaceContent';

/**
 * Container for the MCP tab — routes between installed list and marketplace
 * based on `mcpView` from the library store.
 */
const McpTabContent: React.FC = React.memo(() => {
  const mcpView = useLibraryStore((s) => s.mcpView);
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
    <div className="h-full min-h-0 overflow-hidden">
      {mcpView === 'installed' && (
        <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
          <McpListSection onEdit={handleEdit} />
        </div>
      )}
      {mcpView === 'marketplace' && <McpMarketplaceContent />}
      <McpEditorDialog />
      <McpInstallDialog />
    </div>
  );
});

McpTabContent.displayName = 'McpTabContent';

export default McpTabContent;
