import { Blocks, Library, MessageSquare, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import type {
  PromptInsertTarget,
  PromptResource,
  ResourceKind,
  ResourceSummary,
} from '@/shared/types/library';
import { skillToResourceSummary } from '@/shared/types/library';

import LibraryHeader from './LibraryHeader';
import LibrarySidebar from './LibrarySidebar';
import PromptEditorDialog from './PromptEditorDialog';
import PromptInsertDialog from './PromptInsertDialog';
import PromptListSection from './PromptListSection';
import SkillsTabContent from './SkillsTabContent';

interface TabDef {
  key: ResourceKind;
  label: string;
  icon: React.ElementType;
  count?: number;
}

interface LibraryPanelProps {
  /** Optional callback when a prompt is inserted (provided by wrapper via context). */
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = React.memo(({ onInsertPrompt }) => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  const setActiveKind = useLibraryStore((s) => s.setActiveKind);
  const tagFilter = useLibraryStore((s) => s.tagFilter);
  const scopeFilter = useLibraryStore((s) => s.scopeFilter);
  const prompts = useLibraryStore((s) => s.prompts);
  const refreshPrompts = useLibraryStore((s) => s.refreshPrompts);
  const recordUsage = useLibraryStore((s) => s.recordUsage);

  const skills = useSkillStore((s) => s.skills);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // Refresh prompts when the panel mounts or project changes.
  useEffect(() => {
    void refreshPrompts();
  }, [refreshPrompts, activeProjectId]);

  const skillSummaries = useMemo<ResourceSummary[]>(
    () => skills.map(skillToResourceSummary),
    [skills],
  );

  const promptCount = prompts.length;
  const actionCount = 0; // P1

  const tabs: TabDef[] = useMemo(
    () => [
      { key: 'skill', label: 'Skills', icon: Blocks, count: skillSummaries.length },
      { key: 'prompt', label: 'Prompts', icon: MessageSquare, count: promptCount },
      { key: 'action', label: 'Actions', icon: Zap, count: actionCount },
    ],
    [skillSummaries.length, promptCount, actionCount],
  );

  const handleInsert = useCallback(
    (prompt: PromptResource, target: PromptInsertTarget = 'agent') => {
      void recordUsage(prompt.id);
      onInsertPrompt?.(prompt, target);
    },
    [recordUsage, onInsertPrompt],
  );

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (scopeFilter !== 'all') parts.push(scopeFilter);
    if (tagFilter.length > 0) parts.push(`tags: ${tagFilter.join(', ')}`);
    return parts.join(' · ');
  }, [scopeFilter, tagFilter]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Sidebar filters (prompts only for now) */}
      {activeKind === 'prompt' && (
        <div className="w-44 shrink-0 border-r border-border flex flex-col">
          <div className="flex items-center gap-2 h-10 px-3 border-b border-border shrink-0">
            <Library className="h-4 w-4 text-text-secondary shrink-0" />
            <span className="text-[var(--font-size)] font-semibold text-text-primary">Filters</span>
          </div>
          <LibrarySidebar />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 h-10 px-3 border-b border-border shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeKind === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-md transition-colors',
                  'text-[var(--font-size)]',
                  isActive
                    ? 'bg-bg-selected text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                onClick={() => setActiveKind(tab.key)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="font-medium">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="text-[11px] tabular-nums text-text-muted">{tab.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* Skills tab — always mounted to preserve panel state (view, scroll, etc.) */}
          <div className={cn('flex-1 min-h-0 overflow-hidden', activeKind !== 'skill' && 'hidden')}>
            <SkillsTabContent />
          </div>
          {activeKind === 'prompt' && (
            <>
              <LibraryHeader count={promptCount} filterLabel={filterLabel} />
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
                <PromptListSection onInsert={handleInsert} />
              </div>
            </>
          )}
          {activeKind === 'action' && (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
              <Zap className="h-8 w-8 opacity-30" />
              <p className="text-[var(--font-size)] text-text-secondary text-center">
                Actions coming soon.
              </p>
              <p className="text-[11px] text-text-muted text-center">
                Save terminal commands and workflows as reusable action templates.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <PromptEditorDialog />
      <PromptInsertDialog onInsert={handleInsert} />
    </div>
  );
});

LibraryPanel.displayName = 'LibraryPanel';

export default LibraryPanel;
