import React from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import SkillsPanel from '@/features/skill/components/SkillsPanel';

import LibrarySidebar from './LibrarySidebar';

/**
 * LibraryNavTree — resource-specific navigation tree for v7 两栏 master-detail 布局.
 *
 * Renders different navigation content based on `activeKind` from libraryStore:
 * - skill: full SkillsPanel (Installed/Marketplace/Tags/Agents/Projects)
 * - prompt: scope + tag filters (reuses LibrarySidebar pattern)
 * - action/mcp/command: empty state ("No additional filters")
 *
 * Each nav tree section internally uses group titles (uppercase, tracked) and
 * collapsible chevron icons. The component itself is a scrollable container
 * that switches content based on the active resource kind.
 */
const LibraryNavTree: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar">
      {activeKind === 'skill' && <SkillsPanel />}
      {activeKind === 'prompt' && <LibrarySidebar />}
      {(activeKind === 'action' || activeKind === 'mcp' || activeKind === 'command') && (
        <div className="flex items-center justify-center py-8 px-4">
          <span className="text-[var(--font-size)] text-text-muted text-center">
            No additional filters
          </span>
        </div>
      )}
    </div>
  );
});

LibraryNavTree.displayName = 'LibraryNavTree';

export default LibraryNavTree;
