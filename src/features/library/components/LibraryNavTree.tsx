import React from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { SkillsPanel } from '@/features/skill';

import LibrarySidebar from './LibrarySidebar';
import McpNavPanel from './McpNavPanel';

const LibraryNavTree: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar">
      {activeKind === 'skill' && <SkillsPanel />}
      {activeKind === 'prompt' && <LibrarySidebar />}
      {activeKind === 'mcp' && <McpNavPanel />}
    </div>
  );
});

LibraryNavTree.displayName = 'LibraryNavTree';

export default LibraryNavTree;
