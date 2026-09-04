import { Plus } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import type { ResourceKind } from '@/shared/types/library';

const KIND_LABELS: Record<ResourceKind, string> = {
  skill: 'Skills',
  prompt: 'Prompts',
  mcp: 'MCP',
};

export function deriveSubLabel(
  kind: ResourceKind,
  mcpView: string,
  scopeFilter: string,
  tagFilter: string[],
): string {
  if (kind === 'skill') {
    return 'Installed';
  }
  if (kind === 'mcp') {
    return mcpView === 'marketplace' ? 'Marketplace' : 'Installed';
  }
  if (scopeFilter !== 'all') {
    return scopeFilter.charAt(0).toUpperCase() + scopeFilter.slice(1);
  }
  if (tagFilter.length > 0) {
    return `${tagFilter.length} tag${tagFilter.length > 1 ? 's' : ''}`;
  }
  return 'All';
}

const LibraryToolbar: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  const mcpView = useMcpStore((s) => s.mcpView);
  const mcpMarketplaceCount = useMcpStore((s) => s.mcpMarketplaceCount);
  const scopeFilter = useLibraryStore((s) => s.scopeFilter);
  const tagFilter = useLibraryStore((s) => s.tagFilter);
  const openEditor = useLibraryStore((s) => s.openEditor);
  const openMcpEditor = useMcpStore((s) => s.openMcpEditor);

  const marketplaceTotalItems = useSkillStore((s) => s.marketplaceTotalItems);

  const subLabel = useMemo(
    () => deriveSubLabel(activeKind, mcpView, scopeFilter, tagFilter),
    [activeKind, mcpView, scopeFilter, tagFilter],
  );

  const handleNew = useCallback(() => {
    if (activeKind === 'mcp') {
      openMcpEditor();
    } else {
      openEditor();
    }
  }, [activeKind, openMcpEditor, openEditor]);

  const renderActionButtons = () => {
    const btnBase =
      'h-7 px-2.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors';
    const btnPrimary = `${btnBase} bg-accent-blue text-[var(--text-on-accent)] hover:bg-accent-blue/90`;

    switch (activeKind) {
      case 'skill':
        return null;
      case 'prompt':
      case 'mcp':
        if (activeKind === 'mcp' && mcpView === 'marketplace') return null;
        return (
          <button type="button" className={btnPrimary} onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="shrink-0 h-11 px-4 flex items-center gap-3 border-b border-border">
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-text-primary font-medium">{KIND_LABELS[activeKind]}</span>
        <span className="text-text-muted">/</span>
        <span className="text-text-secondary truncate">{subLabel}</span>
        {activeKind === 'skill' && marketplaceTotalItems > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
            {marketplaceTotalItems}
          </span>
        )}
        {activeKind === 'mcp' && mcpView === 'marketplace' && mcpMarketplaceCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
            {mcpMarketplaceCount}
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 shrink-0">{renderActionButtons()}</div>
    </div>
  );
});

LibraryToolbar.displayName = 'LibraryToolbar';

export default LibraryToolbar;
