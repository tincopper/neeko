import React from 'react';

import { LibraryPanel, useInsertPromptToWorkspace } from '@/features/library';

/**
 * Library dock 面板适配层：Insert 通过 TerminalInsertContext 消费
 * ProjectView 注册的插入能力（terminal → agent → clipboard 兜底）。
 */
const LibraryPanelWrapper: React.FC = React.memo(() => {
  const handleInsertPrompt = useInsertPromptToWorkspace();

  return <LibraryPanel onInsertPrompt={handleInsertPrompt} />;
});

LibraryPanelWrapper.displayName = 'LibraryPanelWrapper';

export default LibraryPanelWrapper;
export { LibraryPanelWrapper };
