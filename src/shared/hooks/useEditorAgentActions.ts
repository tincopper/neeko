import { useCallback, useState } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

// eslint-disable-next-line import/no-restricted-paths -- shared hook depends on editor types for tab kind discrimination
import type { Tab } from '../../features/editor/types';
// eslint-disable-next-line import/no-restricted-paths -- shared hook sends terminal commands via terminal feature
import { sendToTerminal } from '../../features/terminal/components/terminalCommands';

interface PendingAction {
  message: string;
  projectId: ProjectId;
}

export function useEditorAgentActions() {
  const tabs = useEditorStore((s) => s.tabs);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const findAgentTab = useCallback(
    (projectId: ProjectId): Tab | null => {
      const projectTabs = tabs[activeWorkspaceSession(projectId).key];
      if (!projectTabs) return null;
      for (const tab of projectTabs.tabs) {
        if (tab.data.kind === 'terminal' && tab.data.agentId) {
          return tab;
        }
      }
      return null;
    },
    [tabs],
  );

  const sendToAgent = useCallback(
    (projectId: ProjectId, message: string) => {
      const agentTab = findAgentTab(projectId);
      if (agentTab) {
        sendToTerminal(projectId, `${message}\r`, agentTab.id);
        return true;
      }
      setPending({ message, projectId });
      return false;
    },
    [findAgentTab],
  );

  const clearPending = useCallback(() => {
    setPending(null);
  }, []);

  return { sendToAgent, pending, clearPending };
}
