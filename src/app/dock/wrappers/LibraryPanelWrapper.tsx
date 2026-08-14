import React, { useCallback } from 'react';

import { LibraryPanel } from '@/features/library';
import { useAppContext, useTerminalInsert } from '@/shared/contexts';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';

/**
 * Library dock 面板适配层：Insert 通过 TerminalInsertContext 消费
 * ProjectWorkspace 注册的插入能力（terminal → agent → clipboard 兜底）。
 */
const LibraryPanelWrapper: React.FC = React.memo(() => {
  const { showToast } = useAppContext();
  const copyToClipboard = useCopyToClipboard();
  const { api } = useTerminalInsert();

  const handleInsertPrompt = useCallback(
    (prompt: PromptResource, target: PromptInsertTarget = 'agent') => {
      if (target === 'terminal') {
        if (api.insertToTerminal?.(prompt.content)) {
          showToast(`Inserted "${prompt.name}" to terminal`, 'info');
          return;
        }
        // Terminal unavailable — fall through to agent insert.
        showToast('No active terminal — inserting to agent input', 'info');
      }

      if (api.insertToAgentInput) {
        api.insertToAgentInput(prompt.content);
      } else {
        // Fallback: copy to clipboard.
        void copyToClipboard(prompt.content, 'prompt').then((ok) => {
          if (ok) showToast('Prompt copied to clipboard', 'info');
        });
      }
    },
    [showToast, copyToClipboard, api],
  );

  return <LibraryPanel onInsertPrompt={handleInsertPrompt} />;
});
LibraryPanelWrapper.displayName = 'LibraryPanelWrapper';

export default LibraryPanelWrapper;
export { LibraryPanelWrapper };
