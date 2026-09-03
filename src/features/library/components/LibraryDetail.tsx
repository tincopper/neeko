import React from 'react';

import McpTabContent from '@/features/library/components/McpTabContent';
import PromptListSection from '@/features/library/components/PromptListSection';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { SkillContent } from '@/features/skill';
import type { PromptInsertTarget, PromptResource, ResourceKind } from '@/shared/types/library';

import { usePromptInsert } from '../hooks/usePromptInsert';

import LibrarySearchBar from './LibrarySearchBar';
import LibraryToolbar from './LibraryToolbar';

// ─── Constants ──────────────────────────────────────────────────────────────

const SEARCH_PLACEHOLDERS: Record<ResourceKind, string> = {
  skill: 'Search skills…',
  prompt: 'Search prompts…',
  mcp: 'Search MCP servers…',
};

const MCP_PLACEHOLDERS: Record<string, string> = {
  installed: 'Search installed MCP servers…',
  marketplace: 'Search MCP Registry…',
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Resource Library v7 detail panel — toolbar + search + content for the
 * active resource kind. Reads selection state from the relevant store.
 */
const LibraryDetail: React.FC<{
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}> = React.memo(({ onInsertPrompt }) => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  const mcpView = useMcpStore((s) => s.mcpView);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const handleInsert = usePromptInsert(onInsertPrompt);

  return (
    <div className="flex flex-col h-full min-h-0">
      <LibraryToolbar />
      {activeKind !== 'skill' && (
        <LibrarySearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={
            activeKind === 'mcp' ? MCP_PLACEHOLDERS[mcpView] : SEARCH_PLACEHOLDERS[activeKind]
          }
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeKind === 'skill' && <SkillContent titleless />}
        {activeKind === 'prompt' && (
          <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain">
            <PromptListSection onInsert={handleInsert} />
          </div>
        )}
        {activeKind === 'mcp' && <McpTabContent />}
      </div>
    </div>
  );
});

LibraryDetail.displayName = 'LibraryDetail';

export default LibraryDetail;
