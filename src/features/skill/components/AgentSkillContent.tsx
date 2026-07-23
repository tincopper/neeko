import {
  Bot,
  CheckSquare,
  Globe2,
  HardDrive,
  GitBranch,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Store,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Cross-feature toast (same pattern as useLocalSkillActions / SkillsPanel)
// eslint-disable-next-line import/no-restricted-paths -- notification is the shared toast bus
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { importSkillToAgent, removeSkillFromAgent } from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import type { AgentDiskSkill, ManagedSkillDto } from '@/shared/types';
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

const SKILL_SOURCES: Array<{
  value: 'all' | 'local' | 'git' | 'skillssh';
  label: string;
  icon?: React.ReactNode;
}> = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'Local', icon: <HardDrive className="h-3 w-3" /> },
  { value: 'git', label: 'Git', icon: <GitBranch className="h-3 w-3" /> },
  { value: 'skillssh', label: 'skills.sh', icon: <Store className="h-3 w-3" /> },
];

const AgentSkillContent: React.FC<AgentSkillContentProps> = React.memo(({ setDialog }) => {
  const activeAgentId = useSkillStore((s) => s.activeAgentId);
  const skills = useSkillStore((s) => s.skills);
  const groups = useSkillStore((s) => s.agentSkillGroups);
  const refreshAgentSkills = useSkillStore((s) => s.refreshAgentSkills);
  const toast = useNotificationStore((s) => s.addNotification);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'local' | 'git' | 'skillssh'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [pendingRemove, setPendingRemove] = useState<AgentDiskSkill | null>(null);
  const [removing, setRemoving] = useState(false);
  /** Explicit multi-select mode (toggled from toolbar after List view). */
  const [selectionMode, setSelectionMode] = useState(false);
  /** Multi-select: skill paths currently checked for batch actions. */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      try {
        // Shared store: updates left-rail agent counts in SkillsPanel too.
        await refreshAgentSkills();
      } catch {
        /* keep previous */
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [refreshAgentSkills],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Clear search / selection when switching agents
  useEffect(() => {
    setSearchQuery('');
    setImportOpen(false);
    setPendingRemove(null);
    setSelectionMode(false);
    setSelectedPaths(new Set());
    setBulkConfirmOpen(false);
  }, [activeAgentId]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPaths(new Set());
    setBulkConfirmOpen(false);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedPaths(new Set());
        setBulkConfirmOpen(false);
        return false;
      }
      return true;
    });
  }, []);

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

  const getSkillSourceType = useCallback(
    (diskSkill: AgentDiskSkill): 'local' | 'git' | 'skillssh' => {
      if (diskSkill.managed && diskSkill.skill_id) {
        const libSkill = skills.find((s) => s.id === diskSkill.skill_id);
        if (libSkill) return libSkill.source_type as 'local' | 'git' | 'skillssh';
      }
      return 'local';
    },
    [skills],
  );

  const filteredSkills = useMemo(() => {
    if (!activeGroup) return [];
    let list = activeGroup.skills;
    if (sourceFilter !== 'all') {
      list = list.filter((s) => getSkillSourceType(s) === sourceFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [activeGroup, searchQuery, sourceFilter]);

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
      setSelectedPaths((prev) => {
        if (!prev.has(pendingRemove.path)) return prev;
        const next = new Set(prev);
        next.delete(pendingRemove.path);
        return next;
      });
      await reload({ silent: true });
    } catch (e) {
      toast({ type: 'error', title: 'Remove failed', message: String(e) });
    } finally {
      setRemoving(false);
    }
  }, [activeAgentId, pendingRemove, activeGroup, reload, toast]);

  const toggleSelected = useCallback((path: string, checked: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const allFilteredSelected = useMemo(() => {
    if (filteredSkills.length === 0) return false;
    return filteredSkills.every((s) => selectedPaths.has(s.path));
  }, [filteredSkills, selectedPaths]);

  const someFilteredSelected = useMemo(
    () => filteredSkills.some((s) => selectedPaths.has(s.path)),
    [filteredSkills, selectedPaths],
  );

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedPaths((prev) => {
      if (filteredSkills.length === 0) return prev;
      const allOn = filteredSkills.every((s) => prev.has(s.path));
      if (allOn) {
        const next = new Set(prev);
        for (const s of filteredSkills) next.delete(s.path);
        return next;
      }
      const next = new Set(prev);
      for (const s of filteredSkills) next.add(s.path);
      return next;
    });
  }, [filteredSkills]);

  const handleClearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const selectedSkills = useMemo(() => {
    if (!activeGroup || selectedPaths.size === 0) return [] as AgentDiskSkill[];
    return activeGroup.skills.filter((s) => selectedPaths.has(s.path));
  }, [activeGroup, selectedPaths]);

  const handleBulkRemove = useCallback(async () => {
    if (!activeAgentId || selectedSkills.length === 0) return;
    setBulkRemoving(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const skill of selectedSkills) {
        try {
          await removeSkillFromAgent(activeAgentId, skill.path, skill.skill_id);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (ok > 0) {
        toast({
          type: 'success',
          title: 'Removed',
          message:
            failed > 0
              ? `Removed ${ok}; ${failed} failed`
              : `Removed ${ok} skill${ok === 1 ? '' : 's'} from ${activeGroup?.agent_name ?? 'agent'}`,
        });
      } else {
        toast({ type: 'error', title: 'Remove failed', message: 'Could not remove skills' });
      }
      setSelectedPaths(new Set());
      setBulkConfirmOpen(false);
      await reload({ silent: true });
    } finally {
      setBulkRemoving(false);
    }
  }, [activeAgentId, selectedSkills, activeGroup, reload, toast]);

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

      {/* Source filter bar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border shrink-0">
        <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted shrink-0 mr-1">
          Source
        </span>
        {SKILL_SOURCES.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSourceFilter(value)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors',
              sourceFilter === value
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover',
            )}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Toolbar: search + batch + actions */}
      <div className="shrink-0 flex flex-col gap-0 border-b border-border">
        <div className="flex items-center gap-2 px-4 py-2.5">
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
            <button
              type="button"
              onClick={toggleSelectionMode}
              disabled={total === 0}
              title={selectionMode ? 'Exit multi-select' : 'Multi-select'}
              aria-label={selectionMode ? 'Exit multi-select' : 'Multi-select'}
              aria-pressed={selectionMode}
              data-testid="agent-skill-multi-select-toggle"
              className={cn(
                'p-1.5 rounded-md transition-colors',
                selectionMode
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" />
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

        {selectionMode && total > 0 ? (
          <div
            className="flex items-center gap-2 px-4 pb-2.5 flex-wrap border-t border-border/60 pt-2"
            data-testid="agent-skill-batch-bar"
          >
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              disabled={filteredSkills.length === 0}
              data-testid="agent-skill-select-all"
              aria-pressed={allFilteredSelected}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11px] font-medium transition-colors',
                allFilteredSelected || someFilteredSelected
                  ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue'
                  : 'bg-bg-hover/50 border-border text-text-secondary hover:bg-bg-hover',
                'disabled:opacity-50',
              )}
            >
              <span
                className={cn(
                  'w-3.5 h-3.5 rounded border flex items-center justify-center',
                  allFilteredSelected ? 'bg-accent-blue/20 border-accent-blue' : 'border-border',
                )}
                aria-hidden
              >
                {allFilteredSelected ? (
                  <span className="text-[9px] leading-none">✓</span>
                ) : someFilteredSelected ? (
                  <span className="w-1.5 h-0.5 bg-accent-blue rounded" />
                ) : null}
              </span>
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span
              className="text-[11px] text-text-muted tabular-nums"
              data-testid="agent-skill-selected-count"
            >
              {selectedPaths.size} selected
            </span>
            {selectedPaths.size > 0 ? (
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-[11px] text-text-muted hover:text-text-primary"
                data-testid="agent-skill-clear-selection"
              >
                Clear
              </button>
            ) : null}
            <span className="flex-1" />
            {/* Agents view: delete only */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={bulkRemoving || selectedPaths.size === 0}
              onClick={() => setBulkConfirmOpen(true)}
              className="h-7 px-2.5 text-[11px] gap-1.5 text-accent-red border-accent-red/30 hover:bg-accent-red/10 disabled:opacity-40"
              data-testid="agent-skill-bulk-remove"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
            <button
              type="button"
              onClick={exitSelectionMode}
              className="h-7 px-2 text-[11px] text-text-muted hover:text-text-primary rounded-md hover:bg-bg-hover"
              data-testid="agent-skill-exit-selection"
            >
              Done
            </button>
          </div>
        ) : null}
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
              const checked = selectedPaths.has(diskSkill.path);
              return (
                <div key={diskSkill.path} role="listitem" className="min-w-0 h-full">
                  <AgentSkillCard
                    skill={diskSkill}
                    librarySkill={lib}
                    agentIcon={activeGroup.agent_icon}
                    agentName={activeGroup.agent_name}
                    checked={checked}
                    selectionMode={selectionMode}
                    onCheckedChange={
                      selectionMode ? (next) => toggleSelected(diskSkill.path, next) : undefined
                    }
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
            {filteredSkills.map((diskSkill) => {
              const checked = selectedPaths.has(diskSkill.path);
              return (
                <li
                  key={diskSkill.path}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/40 transition-colors',
                    selectionMode && checked && 'bg-accent-blue/[0.04]',
                  )}
                >
                  {selectionMode ? (
                    <button
                      type="button"
                      data-testid={`agent-skill-check-${diskSkill.name}`}
                      aria-label={
                        checked ? `Deselect ${diskSkill.name}` : `Select ${diskSkill.name}`
                      }
                      aria-pressed={checked}
                      onClick={() => toggleSelected(diskSkill.path, !checked)}
                      className={cn(
                        'shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                        checked
                          ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                          : 'border-border bg-transparent text-text-muted',
                      )}
                    >
                      {checked ? <span className="text-[9px] leading-none">✓</span> : null}
                    </button>
                  ) : null}
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
              );
            })}
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !bulkRemoving) setBulkConfirmOpen(false);
        }}
        title={`Remove ${selectedSkills.length} skill${selectedSkills.length === 1 ? '' : 's'}?`}
        description={
          <p className="text-sm text-text-secondary">
            Remove <span className="font-medium text-text-primary">{selectedSkills.length}</span>{' '}
            selected skill{selectedSkills.length === 1 ? '' : 's'} from{' '}
            <span className="font-medium text-text-primary">{activeGroup.agent_name}</span>? Library
            copies are kept.
          </p>
        }
        confirmLabel={bulkRemoving ? 'Removing…' : 'Remove selected'}
        danger
        onConfirm={() => void handleBulkRemove()}
      />
    </div>
  );
});

AgentSkillContent.displayName = 'AgentSkillContent';

export default AgentSkillContent;
