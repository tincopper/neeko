import { Download, Package } from 'lucide-react';
import React from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import SkillsPanel from '@/features/skill/components/SkillsPanel';
import { cn } from '@/lib/utils';

import LibrarySidebar from './LibrarySidebar';

/**
 * LibraryNavTree — resource-specific navigation tree for v7 两栏 master-detail 布局.
 *
 * Renders different navigation content based on `activeKind` from libraryStore:
 * - skill: full SkillsPanel (Installed/Marketplace/Tags/Agents/Projects)
 * - prompt: scope + tag filters (reuses LibrarySidebar pattern)
 * - mcp: tree-grp (Installed/Marketplace) with view switching
 * - action/command: empty state ("No additional filters")
 *
 * Each nav tree section internally uses group titles (uppercase, tracked) and
 * collapsible chevron icons. The component itself is a scrollable container
 * that switches content based on the active resource kind.
 */
const LibraryNavTree: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  const mcpView = useLibraryStore((s) => s.mcpView);
  const setMcpView = useLibraryStore((s) => s.setMcpView);
  const mcpServers = useLibraryStore((s) => s.mcpServers);

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar">
      {activeKind === 'skill' && <SkillsPanel />}
      {activeKind === 'prompt' && <LibrarySidebar />}
      {activeKind === 'mcp' && (
        <div className="py-2 px-1.5">
          <button
            type="button"
            className={cn(
              'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150 text-[var(--font-size)]',
              mcpView === 'installed'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
            onClick={() => setMcpView('installed')}
          >
            <Package className="h-[13px] w-[13px] shrink-0" />
            <span className="truncate flex-1 font-medium">Installed</span>
            <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
              {mcpServers.length}
            </span>
          </button>
          <button
            type="button"
            className={cn(
              'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150 text-[var(--font-size)]',
              mcpView === 'marketplace'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
            onClick={() => setMcpView('marketplace')}
          >
            <Download className="h-[13px] w-[13px] shrink-0" />
            <span className="truncate flex-1 font-medium">Marketplace</span>
          </button>
        </div>
      )}
      {(activeKind === 'action' || activeKind === 'command') && (
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
