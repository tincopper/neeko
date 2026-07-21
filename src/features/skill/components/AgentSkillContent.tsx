import {
  Bot,
  Globe2,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Cross-feature toast (same pattern as useLocalSkillActions / SkillsPanel)
// eslint-disable-next-line import/no-restricted-paths -- notification is the shared toast bus
import { useNotificationStore } from '@/features/notification/notificationStore';
import {
  getAgentSkills,
  importSkillToAgent,
  removeSkillFromAgent,
} from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import type { AgentDiskSkill, AgentSkillGroup, ManagedSkillDto } from '@/shared/types';
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { Button } from '@/ui';

import AgentSkillCard from './AgentSkillCard';
import ImportToAgentDialog from './ImportToAgentDialog';
import type { SkillDialogState } from './skillItemTypes';

interface AgentSkillContentProps {
  setDialog: (state: SkillDialogState) => void;
}

type ViewMode = 'grid' | 'list';

function homeTildePath(path: string | null): string {
  if (!path) return 'No skill path configured';
  // Cosmetic: collapse $HOME / users home for display
  try {
    // Browser has no process.env.HOME; show as-is if we can't compress
    return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  } catch {
    return path;
  }
}

const AgentSkillContent: React.FC<AgentSkillContentProps> = React.memo(({ setDialog }) => {
  const activeAgentId = useSkillStore((s) => s.activeAgentId);
  const skills = useSkillStore((s) => s.skills);
  const toast = useNotificationStore((s) => s.addNotification);

  const [groups, setGroups] = useState<AgentSkillGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [pendingRemove, setPendingRemove] = useState<AgentDiskSkill | null>(null);
  const [removing, setRemoving] = useState(false);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await getAgentSkills();
      setGroups(data);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Clear search when switching agents
  useEffect(() => {
    setSearchQuery('');
    setImportOpen(false);
    setPendingRemove(null);
  }, [activeAgentId]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.agent_id === activeAgentId) ?? null,
    [groups, activeAgentId],
  );

  const existingNames = useMemo(
    () => new Set(activeGroup?.skills.map((s) => s.name) ?? []),
    [activeGroup],
  );

  const importableSkills = useMemo(
    () => skills.filter((s) => !existingNames.has(s.name)),
    [skills, existingNames],
  );

  const managedCount = useMemo(
    () => activeGroup?.skills.filter((s) => s.managed).length ?? 0,
    [activeGroup],
  );

  const filteredSkills = useMemo(() => {
    if (!activeGroup) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeGroup.skills;
    return activeGroup.skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
    );
  }, [activeGroup, searchQuery]);

  const handleImportMany = useCallback(
    async (skillIds: string[]) => {
      if (!activeAgentId || skillIds.length === 0) return;
      setImporting(true);
      let ok = 0;
      let failed = 0;
      try {
        for (const id of skillIds) {
          try {
            await importSkillToAgent(id, activeAgentId);
            ok += 1;
          } catch {
            failed += 1;
          }
        }
        if (ok > 0) {
          toast({
            type: 'success',
            title: 'Imported',
            message:
              failed > 0
                ? `${ok} skill${ok === 1 ? '' : 's'} added; ${failed} failed`
                : `${ok} skill${ok === 1 ? '' : 's'} added to ${activeGroup?.agent_name ?? 'agent'}`,
          });
        } else {
          toast({ type: 'error', title: 'Import failed', message: 'Could not import skills' });
        }
        await reload({ silent: true });
        setImportOpen(false);
      } finally {
        setImporting(false);
      }
    },
    [activeAgentId, activeGroup, reload, toast],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (!activeAgentId || !pendingRemove) return;
    setRemoving(true);
    try {
      await removeSkillFromAgent(activeAgentId, pendingRemove.path, pendingRemove.skill_id);
      toast({
        type: 'success',
        title: 'Removed',
        message: `"${pendingRemove.name}" removed from ${activeGroup?.agent_name ?? 'agent'}`,
      });
      setPendingRemove(null);
      await reload({ silent: true });
    } catch (e) {
      toast({ type: 'error', title: 'Remove failed', message: String(e) });
    } finally {
      setRemoving(false);
    }
  }, [activeAgentId, pendingRemove, activeGroup, reload, toast]);

  /** View any agent skill: prefer Library document when managed, else disk path. */
  const openViewSkill = useCallback(
    (diskSkill: AgentDiskSkill) => {
      if (diskSkill.managed && diskSkill.skill_id) {
        const libSkill = skills.find((s) => s.id === diskSkill.skill_id);
        if (libSkill) {
          setDialog({ type: 'view', skill: libSkill as ManagedSkillDto });
          return;
        }
      }
      setDialog({ type: 'view-disk', skill: diskSkill });
    },
    [skills, setDialog],
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-32 text-text-muted"
        data-testid="agent-skill-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6 text-center">
        <Bot className="h-8 w-8 opacity-60" />
        <p className="text-sm text-text-secondary font-medium">Select an agent</p>
        <p className="text-[11px] max-w-[240px] leading-relaxed">
          Choose an agent from the sidebar to view and manage its skills.
        </p>
      </div>
    );
  }

  const icon = resolveAgentIconSrc(activeGroup.agent_icon);
  const total = activeGroup.skills.length;
  const pathLabel = homeTildePath(activeGroup.agent_skill_path);
  const canAdd = Boolean(activeGroup.agent_skill_path);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" data-testid="agent-skill-content">
      {/* Header: agent identity + path stats */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2.5 h-11 px-4">
          {icon ? (
            <img src={icon} alt="" className="h-5 w-5 rounded shrink-0" />
          ) : (
            <Terminal className="h-4 w-4 text-text-secondary shrink-0" />
          )}
          <h2 className="text-sm font-semibold text-text-primary truncate">
            {activeGroup.agent_name}
          </h2>
          <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
            {total}
          </span>
          {!activeGroup.agent_enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700 font-medium">
              disabled
            </span>
          )}
        </div>
        <div
          className="px-4 pb-2.5 text-[11px] text-text-muted truncate"
          title={activeGroup.agent_skill_path ?? undefined}
        >
          <span className="font-mono text-text-secondary/90">{pathLabel}</span>
          <span className="mx-1.5 opacity-50">·</span>
          <span>
            {total} / {managedCount} managed / {managedCount} synced
          </span>
        </div>
      </div>

      {/* Toolbar: search + actions */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agent skills…"
            className={cn(
              'w-full h-8 pl-8 text-[var(--font-size)] rounded-lg',
              'bg-bg-hover/50 border border-border/80',
              'text-text-primary placeholder:text-text-muted',
              'outline-none focus:border-border focus:bg-bg-primary transition-colors',
              searchQuery ? 'pr-8' : 'pr-3',
            )}
            aria-label="Search agent skills"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => void reload({ silent: true })}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh agent skills"
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'grid'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List view"
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'list'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canAdd}
            onClick={() => setImportOpen(true)}
            title={canAdd ? 'Add skill from library' : 'Agent has no skill path configured'}
            className="h-8 px-3 ml-1 text-xs gap-1.5 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Skill
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
        {total === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 px-6 text-center"
            data-testid="agent-skill-empty"
          >
            <div className="w-14 h-14 rounded-2xl bg-bg-hover/80 flex items-center justify-center mb-4">
              <Globe2 className="h-7 w-7 text-text-muted opacity-70" />
            </div>
            <p className="text-sm text-text-secondary font-medium">No local skills found</p>
            <p className="text-[11px] text-text-muted mt-1.5 max-w-[280px] leading-relaxed">
              {canAdd
                ? 'Import skills from your Library to this agent, or place skill folders in its skill path.'
                : 'Configure a skill path for this agent in Settings to manage skills here.'}
            </p>
            {canAdd ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="mt-5 h-9 px-4 text-xs gap-1.5 font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Skill
              </Button>
            ) : null}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-text-muted">
            <p className="text-sm text-text-secondary">No matching skills</p>
            <p className="text-[11px] mt-1">Try a different search term.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div
            className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start"
            role="list"
            aria-label={`Agent skills (${filteredSkills.length})`}
          >
            {filteredSkills.map((diskSkill) => {
              const lib =
                diskSkill.skill_id != null
                  ? (skills.find((s) => s.id === diskSkill.skill_id) ?? null)
                  : null;
              return (
                <div key={diskSkill.path} role="listitem" className="min-w-0 h-full">
                  <AgentSkillCard
                    skill={diskSkill}
                    librarySkill={lib}
                    agentIcon={activeGroup.agent_icon}
                    agentName={activeGroup.agent_name}
                    onSelect={() => openViewSkill(diskSkill)}
                    onView={() => openViewSkill(diskSkill)}
                    onRemove={() => setPendingRemove(diskSkill)}
                    removing={removing && pendingRemove?.path === diskSkill.path}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <ul
            className="divide-y divide-border/60"
            aria-label={`Agent skills (${filteredSkills.length})`}
          >
            {filteredSkills.map((diskSkill) => (
              <li
                key={diskSkill.path}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {diskSkill.name}
                    </span>
                    {diskSkill.managed ? (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-bg-selected text-text-secondary border border-border font-medium">
                        Synced
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-bg-hover text-text-muted border border-border font-medium">
                        Local
                      </span>
                    )}
                  </div>
                  {diskSkill.description ? (
                    <p className="text-[11px] text-text-muted truncate mt-0.5">
                      {diskSkill.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => openViewSkill(diskSkill)}
                  className="shrink-0 text-[11px] font-medium text-accent-blue hover:brightness-110"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemove(diskSkill)}
                  className="shrink-0 p-1 rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                  aria-label={`Remove ${diskSkill.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {importOpen ? (
        <ImportToAgentDialog
          key={activeGroup.agent_id}
          open
          agentName={activeGroup.agent_name}
          agentIcon={activeGroup.agent_icon}
          importableSkills={importableSkills}
          importing={importing}
          onClose={() => setImportOpen(false)}
          onImport={handleImportMany}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="Remove skill from agent?"
        description={
          pendingRemove ? (
            <p className="text-sm text-text-secondary">
              Remove <span className="font-medium text-text-primary">{pendingRemove.name}</span>{' '}
              from <span className="font-medium text-text-primary">{activeGroup.agent_name}</span>?
              This only unlinks it from the agent; the Library copy is kept.
            </p>
          ) : null
        }
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        danger
        onConfirm={() => void handleRemoveConfirm()}
      />
    </div>
  );
});

AgentSkillContent.displayName = 'AgentSkillContent';

export default AgentSkillContent;
