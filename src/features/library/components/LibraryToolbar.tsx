import { Download, Plus, Upload } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useSkillStore } from '@/features/skill/store';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { ResourceKind } from '@/shared/types/library';

import { exportLibraryBundle, importLibraryBundle } from '../api/libraryApi';

// ─── Constants ──────────────────────────────────────────────────────────────

const KIND_LABELS: Record<ResourceKind, string> = {
  skill: 'Skills',
  prompt: 'Prompts',
  action: 'Actions',
  mcp: 'MCP',
  command: 'Commands',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive the breadcrumb subLabel from the active kind and its current
 * selection in the relevant store. Each sub-panel owns its own selection
 * state — this function reads from the right source per kind.
 */
function deriveSubLabel(
  kind: ResourceKind,
  skillView: string,
  mcpView: string,
  scopeFilter: string,
  tagFilter: string[],
  agentId: string | null,
  projectId: string | null,
): string {
  switch (kind) {
    case 'skill':
      switch (skillView) {
        case 'local':
          return 'Installed';
        case 'marketplace':
          return 'Marketplace';
        case 'agents':
          return agentId ?? 'Agents';
        case 'project':
          return projectId ?? 'Project';
        default:
          return 'Installed';
      }
    case 'prompt':
      if (scopeFilter === 'global') return 'Global';
      if (scopeFilter === 'project') return 'Project';
      if (tagFilter.length > 0) return `#${tagFilter[0]}`;
      return 'All';
    case 'mcp':
      return mcpView === 'marketplace' ? 'Marketplace' : 'Installed';
    case 'action':
    case 'command':
    default:
      return 'All';
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Library toolbar — breadcrumb + action buttons (New / Import / Export).
 * Reads selection state from the relevant store; no props required.
 */
const LibraryToolbar: React.FC = React.memo(() => {
  // Library store
  const activeKind = useLibraryStore((s) => s.activeKind);
  const mcpView = useLibraryStore((s) => s.mcpView);
  const scopeFilter = useLibraryStore((s) => s.scopeFilter);
  const tagFilter = useLibraryStore((s) => s.tagFilter);
  const openEditor = useLibraryStore((s) => s.openEditor);
  const openActionEditor = useLibraryStore((s) => s.openActionEditor);
  const openMcpEditor = useLibraryStore((s) => s.openMcpEditor);

  // Skill store
  const activeSkillView = useSkillStore((s) => s.activeSkillView);
  const activeAgentId = useSkillStore((s) => s.activeAgentId);
  const marketplaceTotalItems = useSkillStore((s) => s.marketplaceTotalItems);
  const mcpMarketplaceCount = useLibraryStore((s) => s.mcpMarketplaceCount);

  // Project store
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // Breadcrumb subLabel
  const subLabel = useMemo(
    () =>
      deriveSubLabel(
        activeKind,
        activeSkillView,
        mcpView,
        scopeFilter,
        tagFilter,
        activeAgentId,
        activeProjectId,
      ),
    [activeKind, activeSkillView, mcpView, scopeFilter, tagFilter, activeAgentId, activeProjectId],
  );

  const handleNew = useCallback(() => {
    if (activeKind === 'action') {
      openActionEditor(null);
    } else if (activeKind === 'mcp') {
      if (mcpView === 'installed') {
        openMcpEditor(null);
      }
    } else if (activeKind === 'command') {
      openEditor(null, 'command');
    } else {
      openEditor(null);
    }
  }, [activeKind, mcpView, openEditor, openActionEditor, openMcpEditor]);

  const handleExport = useCallback(async () => {
    try {
      // Dynamic import: Tauri plugin-dialog only exists in the Tauri runtime (not plain browser).
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: 'neeko-library.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await exportLibraryBundle(filePath);
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'Exported',
          message: 'Library exported successfully',
        });
      }
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Export Failed',
        message: String(e),
      });
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      // Dynamic import: Tauri plugin-dialog only exists in the Tauri runtime (not plain browser).
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (filePath && typeof filePath === 'string') {
        const result = await importLibraryBundle(filePath, 'skip');
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'Imported',
          message: `Imported ${result.promptsImported} prompts, ${result.actionsImported} actions (${result.promptsSkipped + result.actionsSkipped} skipped)`,
        });
      }
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Import Failed',
        message: String(e),
      });
    }
  }, []);

  // ── Render action buttons based on activeKind ──────────────────────────

  const renderActionButtons = () => {
    const btnBase =
      'h-7 px-2.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors';
    const btnPrimary = `${btnBase} bg-accent-blue text-[var(--text-on-accent)] hover:bg-accent-blue/90`;
    const btnSecondary = `${btnBase} bg-bg-hover text-text-secondary border border-border hover:bg-bg-active`;

    switch (activeKind) {
      case 'skill':
        return null;
      case 'prompt':
        return (
          <>
            <button type="button" className={btnPrimary} onClick={handleNew}>
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </button>
            <button type="button" className={btnSecondary} onClick={() => void handleImport()}>
              <Upload className="h-3.5 w-3.5" />
              <span>Import</span>
            </button>
            <button type="button" className={btnSecondary} onClick={() => void handleExport()}>
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
            </button>
          </>
        );
      case 'mcp':
        if (mcpView === 'marketplace') return null;
        return (
          <button type="button" className={btnPrimary} onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        );
      case 'action':
      case 'command':
      default:
        return (
          <button type="button" className={btnPrimary} onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        );
    }
  };

  return (
    <div className="shrink-0 h-11 px-4 flex items-center gap-3 border-b border-border">
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-text-primary font-medium">{KIND_LABELS[activeKind]}</span>
        <span className="text-text-muted">/</span>
        <span className="text-text-secondary truncate">{subLabel}</span>
        {activeKind === 'skill' &&
          activeSkillView === 'marketplace' &&
          marketplaceTotalItems > 0 && (
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
