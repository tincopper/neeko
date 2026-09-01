import React, { useCallback, useEffect, useMemo } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import type { McpServer } from '@/shared/types/mcpServer';

import McpAgentContent from './McpAgentContent';
import McpEditorDialog from './McpEditorDialog';
import McpInstallDialog from './McpInstallDialog';
import McpListSection from './McpListSection';
import McpMarketplaceContent from './McpMarketplaceContent';
import McpProjectContent from './McpProjectContent';

const McpTabContent: React.FC = React.memo(() => {
  const mcpView = useMcpStore((s) => s.mcpView);
  const refreshMcpServers = useMcpStore((s) => s.refreshMcpServers);
  const openMcpEditor = useMcpStore((s) => s.openMcpEditor);
  const activeMcpTagGroup = useMcpStore((s) => s.activeMcpTagGroup);
  const mcpTagGroups = useMcpStore((s) => s.mcpTagGroups);
  const activeMcpAgentId = useMcpStore((s) => s.activeMcpAgentId);
  const activeMcpProjectId = useMcpStore((s) => s.activeMcpProjectId);

  useEffect(() => {
    void refreshMcpServers();
  }, [refreshMcpServers]);

  const handleEdit = useCallback(
    (server: McpServer) => {
      openMcpEditor(server);
    },
    [openMcpEditor],
  );

  const activeTagGroupName = useMemo(() => {
    if (!activeMcpTagGroup) return null;
    return mcpTagGroups.find((tg) => tg.id === activeMcpTagGroup)?.name ?? null;
  }, [activeMcpTagGroup, mcpTagGroups]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {mcpView === 'installed' && activeTagGroupName && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
              Tag group:
            </span>
            <span className="text-[var(--font-size)] font-semibold text-text-primary">
              {activeTagGroupName}
            </span>
            <button
              type="button"
              onClick={() => useMcpStore.getState().setActiveMcpTagGroup(null)}
              className="ml-auto text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              Clear filter
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {mcpView === 'installed' && (
          <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain">
            <McpListSection onEdit={handleEdit} />
          </div>
        )}
        {mcpView === 'marketplace' && <McpMarketplaceContent />}
        {mcpView === 'agent' && activeMcpAgentId && <McpAgentContent agentId={activeMcpAgentId} />}
        {mcpView === 'project' && activeMcpProjectId && (
          <McpProjectContent projectId={activeMcpProjectId} />
        )}
      </div>
      <McpEditorDialog />
      <McpInstallDialog />
    </div>
  );
});

McpTabContent.displayName = 'McpTabContent';

export default McpTabContent;
