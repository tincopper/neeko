import {
  Folder,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- list agents for targets + card icons
import { listAgents, resolveAgentIconSrc } from '@/features/agent/api/agentApi';
// eslint-disable-next-line import/no-restricted-paths -- shared toast bus
import { useNotificationStore } from '@/features/notification/notificationStore';
// eslint-disable-next-line import/no-restricted-paths -- active project
import { useProjectStore } from '@/features/project/store';
import {
  getProjectSkills,
  getSkillsForTagGroup,
  importSkillsToProject,
  removeSkillFromProject,
  setProjectSkillAgentEnabled,
  setProjectSkillEnabled,
} from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import type { ManagedSkillDto, ProjectDiskSkill } from '@/shared/types';
import { Button } from '@/ui';

import ImportToProjectDialog, { type ProjectAgentOption } from './ImportToProjectDialog';
import ProjectSkillCard from './ProjectSkillCard';
import type { SkillDialogState } from './skillItemTypes';

interface ProjectSkillContentProps {
  setDialog?: (state: SkillDialogState) => void;
}

type ViewMode = 'grid' | 'list';
type StatusFilter = 'all' | 'enabled' | 'disabled';

/** Built-in agents with tool-adapter project-relative skill dirs. */
const PROJECT_CAPABLE_AGENT_KEYS = new Set([
  'opencode',
  'claude-code',
  'gemini',
  'codex',
  'qoder',
  'codebuddy',
  'pi',
  'omp',
  'reasonix',
  'cursor',
  'windsurf',
]);

/** Builtin adapters, or custom agents (with or without skill_path — backend falls back). */
function isProjectCapable(agentId: string, skillPath?: string | null): boolean {
  if (PROJECT_CAPABLE_AGENT_KEYS.has(agentId)) return true;
  const stripped = agentId.startsWith('custom:') ? agentId.slice('custom:'.length) : agentId;
  if (PROJECT_CAPABLE_AGENT_KEYS.has(stripped)) return true;
  // Custom agents are always installable under project (via skill_path or .agents/{id}/skills)
  if (agentId.startsWith('custom:')) return true;
  // Any agent with a configured skill path can map into the project
  if (skillPath && skillPath.trim()) return true;
  return false;
}

function displayPath(path: string | undefined | null): string {
  if (!path) return '';
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

const ProjectSkillContent: React.FC<ProjectSkillContentProps> = React.memo(({ setDialog }) => {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);
  const librarySkills = useSkillStore((s) => s.skills);
  const tagGroups = useSkillStore((s) => s.tagGroups);
  const refreshSkills = useSkillStore((s) => s.refreshSkills);
  const refreshTagGroups = useSkillStore((s) => s.refreshTagGroups);
  const refreshProjectSkillCounts = useSkillStore((s) => s.refreshProjectSkillCounts);

  const [diskSkills, setDiskSkills] = useState<ProjectDiskSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  /** `'all'` or a specific agent id */
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [agents, setAgents] = useState<ProjectAgentOption[]>([]);
  const [pendingRemove, setPendingRemove] = useState<ProjectDiskSkill | null>(null);
  const [removing, setRemoving] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
      title: type === 'error' ? 'Error' : 'Project Skills',
      message,
    });
  }, []);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!activeProject?.path) {
        setDiskSkills([]);
        setLoading(false);
        return;
      }
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      try {
        const data = await getProjectSkills(activeProject.path);
        setDiskSkills(data);
      } catch (e) {
        toast(String(e), 'error');
        setDiskSkills([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeProject?.path, toast],
  );

  const refreshCounts = useCallback(async () => {
    try {
      await refreshProjectSkillCounts();
    } catch (e) {
      toast(`Failed to refresh project skill counts: ${String(e)}`, 'error');
    }
  }, [refreshProjectSkillCounts, toast]);

  useEffect(() => {
    void refreshSkills();
    void refreshTagGroups();
    void listAgents()
      .then((list) =>
        setAgents(
          list
            .filter((a) => a.enabled)
            .map((a) => ({
              id: a.id,
              name: a.name,
              icon: a.icon ?? null,
              projectCapable: isProjectCapable(a.id, a.skill_path),
            })),
        ),
      )
      .catch(() => setAgents([]));
  }, [refreshSkills, refreshTagGroups]);

  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setAgentFilter('all');
    setImportOpen(false);
    setPendingRemove(null);
    void reload();
  }, [activeProjectId, reload]);

  const existingNames = useMemo(() => new Set(diskSkills.map((s) => s.name)), [diskSkills]);

  /** Agents that currently have at least one skill in this project (for filter chips). */
  const agentsInProject = useMemo(() => {
    const ids = new Set<string>();
    for (const s of diskSkills) {
      for (const id of s.agent_ids) ids.add(id);
    }
    return agents.filter((a) => ids.has(a.id));
  }, [diskSkills, agents]);

  const filteredSkills = useMemo(() => {
    let list = diskSkills;
    if (statusFilter === 'enabled') list = list.filter((s) => s.enabled);
    if (statusFilter === 'disabled') list = list.filter((s) => !s.enabled);
    if (agentFilter !== 'all') {
      list = list.filter(
        (s) =>
          s.agent_ids.includes(agentFilter) ||
          (s.agents ?? []).some((a) => a.agent_id === agentFilter),
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [diskSkills, statusFilter, agentFilter, searchQuery]);

  const handleToggleAgent = useCallback(
    async (skill: ProjectDiskSkill, agentId: string, enabled: boolean) => {
      if (!activeProject?.path) return;
      const key = `${skill.name}:${agentId}`;
      setTogglingKey(key);
      try {
        await setProjectSkillAgentEnabled(
          activeProject.path,
          skill.name,
          agentId,
          enabled,
          skill.skill_id,
        );
        await reload({ silent: true });
        await refreshCounts();
      } catch (e) {
        toast(String(e), 'error');
      } finally {
        setTogglingKey(null);
      }
    },
    [activeProject?.path, refreshCounts, reload, toast],
  );

  const handleToggleEnabled = useCallback(
    async (skill: ProjectDiskSkill, enabled: boolean) => {
      if (!activeProject?.path) return;
      const agentIds = skill.agent_ids.length
        ? skill.agent_ids
        : (skill.agents ?? []).map((a) => a.agent_id);
      if (agentIds.length === 0) return;
      setTogglingKey(skill.name);
      try {
        await setProjectSkillEnabled(
          activeProject.path,
          skill.name,
          agentIds,
          enabled,
          skill.skill_id,
        );
        await reload({ silent: true });
        await refreshCounts();
      } catch (e) {
        toast(String(e), 'error');
      } finally {
        setTogglingKey(null);
      }
    },
    [activeProject?.path, refreshCounts, reload, toast],
  );

  const handleImport = useCallback(
    async ({ skillIds, agentIds }: { skillIds: string[]; agentIds: string[] }) => {
      if (!activeProject?.path) return;
      setImporting(true);
      try {
        const n = await importSkillsToProject(activeProject.path, skillIds, agentIds);
        toast(`Installed ${n} deployment${n === 1 ? '' : 's'} into project agent dirs`, 'success');
        setImportOpen(false);
        await reload({ silent: true });
        await refreshCounts();
      } catch (e) {
        toast(String(e), 'error');
        throw e;
      } finally {
        setImporting(false);
      }
    },
    [activeProject?.path, reload, refreshCounts, toast],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (!pendingRemove || !activeProject?.path) return;
    setRemoving(true);
    try {
      await removeSkillFromProject(
        activeProject.path,
        pendingRemove.name,
        pendingRemove.agent_ids,
        pendingRemove.skill_id,
      );
      toast(`Removed "${pendingRemove.name}" from project`, 'success');
      setPendingRemove(null);
      await reload({ silent: true });
      await refreshCounts();
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setRemoving(false);
    }
  }, [pendingRemove, activeProject?.path, reload, refreshCounts, toast]);

  const openView = useCallback(
    (skill: ProjectDiskSkill) => {
      if (skill.skill_id) {
        const lib = librarySkills.find((s) => s.id === skill.skill_id);
        if (lib) {
          setDialog?.({ type: 'view', skill: lib });
          return;
        }
      }
      setDialog?.({
        type: 'view-disk',
        skill: {
          name: skill.name,
          description: skill.description,
          path: skill.path,
          managed: skill.managed,
          skill_id: skill.skill_id,
        },
      });
    },
    [librarySkills, setDialog],
  );

  const fetchGroupSkills = useCallback(
    (tagGroupId: string) => getSkillsForTagGroup(tagGroupId),
    [],
  );

  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 px-8">
        <div className="w-12 h-12 rounded-xl bg-bg-hover flex items-center justify-center">
          <Folder className="h-6 w-6 opacity-50" />
        </div>
        <p className="text-sm text-text-secondary font-medium">No project selected</p>
        <p className="text-[11px] text-center max-w-[280px] leading-relaxed">
          Select a project in the sidebar to manage skills under its agent directories (e.g.
          .claude/skills).
        </p>
      </div>
    );
  }

  const total = diskSkills.length;
  const enabledCount = diskSkills.filter((s) => s.enabled).length;
  const pathLabel = displayPath(activeProject.path);

  return (
    <div
      className="h-full min-h-0 flex flex-col overflow-hidden"
      data-testid="project-skill-content"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2.5 h-11 px-4">
          <Folder className="h-4 w-4 text-text-secondary shrink-0" />
          <h2 className="text-sm font-semibold text-text-primary truncate">{activeProject.name}</h2>
          <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
            {total} / {enabledCount}
          </span>
        </div>
        <div
          className="px-4 pb-2.5 text-[11px] text-text-muted truncate"
          title={activeProject.path}
        >
          <span className="font-mono text-text-secondary/90">
            {pathLabel || activeProject.path}
          </span>
          {total > 0 ? (
            <>
              <span className="mx-1.5 opacity-50">·</span>
              <span>
                {total} / {enabledCount} enabled
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search project skills…"
            aria-label="Search project skills"
            className={cn(
              'w-full h-8 pl-8 text-[var(--font-size)] rounded-lg',
              'bg-bg-hover/50 border border-border/80',
              'text-text-primary placeholder:text-text-muted',
              'outline-none focus:border-border focus:bg-bg-primary transition-colors',
              searchQuery ? 'pr-8' : 'pr-3',
            )}
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

        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-hover/60 border border-border shrink-0">
          {(
            [
              ['all', 'All'],
              ['enabled', 'Enabled'],
              ['disabled', 'Disabled'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                'h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors',
                statusFilter === key
                  ? 'bg-bg-selected text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Agent filter — icons only; agents that have skills in this project */}
        {agentsInProject.length > 0 ? (
          <div
            className="flex items-center gap-1 min-w-0 max-w-full overflow-x-auto thin-scrollbar shrink-0"
            role="group"
            aria-label="Filter by agent"
          >
            <button
              type="button"
              onClick={() => setAgentFilter('all')}
              title="All agents"
              aria-label="All agents"
              aria-pressed={agentFilter === 'all'}
              className={cn(
                'shrink-0 h-7 px-2 text-[11px] font-medium rounded-md border transition-colors',
                agentFilter === 'all'
                  ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/40'
                  : 'bg-bg-hover/50 text-text-secondary border-border hover:bg-bg-hover',
              )}
            >
              All
            </button>
            {agentsInProject.map((agent) => {
              const active = agentFilter === agent.id;
              const iconSrc = resolveAgentIconSrc(agent.icon);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setAgentFilter(agent.id)}
                  title={agent.name}
                  aria-label={agent.name}
                  aria-pressed={active}
                  className={cn(
                    'shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors',
                    active
                      ? 'bg-accent-blue/15 border-accent-blue/40 ring-1 ring-accent-blue/30'
                      : 'bg-bg-hover/50 border-border hover:bg-bg-hover',
                  )}
                >
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className="h-4 w-4 rounded-[3px]" />
                  ) : (
                    <span className="text-[10px] font-semibold text-text-muted">
                      {agent.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center gap-0.5 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => void reload({ silent: true })}
            disabled={refreshing || loading}
            title="Refresh"
            aria-label="Refresh project skills"
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
            onClick={() => setImportOpen(true)}
            className="h-8 px-3 ml-1 text-xs gap-1.5 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Skill
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
        {loading ? (
          <div
            className="flex items-center justify-center h-32 text-text-muted gap-2"
            data-testid="project-skill-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : total === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 px-6 text-center"
            data-testid="project-skill-empty"
          >
            <div className="w-14 h-14 rounded-2xl bg-bg-hover/80 flex items-center justify-center mb-4">
              <Layers className="h-7 w-7 text-text-muted opacity-70" />
            </div>
            <p className="text-sm text-text-secondary font-medium">No skills in this project</p>
            <p className="text-[11px] text-text-muted mt-1.5 max-w-[340px] leading-relaxed">
              No agent skill directories found under this project. Create paths like{' '}
              <span className="font-mono text-text-secondary">.claude/skills/</span> or add skills
              from the library for selected agents.
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setImportOpen(true)}
              className="mt-5 h-9 px-4 text-xs gap-1.5 font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Add from Library
            </Button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-text-muted">
            <p className="text-sm text-text-secondary">No matching skills</p>
            <p className="text-[11px] mt-1">Try another search or filter.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div
            className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start"
            role="list"
            aria-label={`Project skills (${filteredSkills.length})`}
          >
            {filteredSkills.map((skill) => (
              <div key={`${skill.name}:${skill.path}`} role="listitem" className="min-w-0 h-full">
                <ProjectSkillCard
                  skill={skill}
                  agents={agents}
                  onSelect={() => openView(skill)}
                  onView={() => openView(skill)}
                  onRemove={() => setPendingRemove(skill)}
                  onToggleAgent={(agentId, enabled) =>
                    void handleToggleAgent(skill, agentId, enabled)
                  }
                  onToggleEnabled={(enabled) => void handleToggleEnabled(skill, enabled)}
                  toggling={
                    togglingKey === skill.name ||
                    (togglingKey?.startsWith(`${skill.name}:`) ?? false)
                  }
                  removing={removing && pendingRemove?.name === skill.name}
                />
              </div>
            ))}
          </div>
        ) : (
          <ul
            className="divide-y divide-border/60"
            aria-label={`Project skills (${filteredSkills.length})`}
          >
            {filteredSkills.map((skill) => (
              <li
                key={`${skill.name}:${skill.path}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {skill.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleEnabled(skill, !skill.enabled)}
                      title={skill.enabled ? 'Disable for all agents' : 'Enable for all agents'}
                      className={cn(
                        'shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border font-semibold transition-colors cursor-pointer',
                        skill.enabled
                          ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/20'
                          : 'bg-bg-hover text-text-muted border-border hover:bg-bg-selected hover:text-text-secondary',
                      )}
                    >
                      {skill.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  {skill.description ? (
                    <p className="text-[11px] text-text-muted truncate mt-0.5">
                      {skill.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(skill.agents ?? []).map((st) => {
                    const meta = agents.find((a) => a.id === st.agent_id);
                    const src = resolveAgentIconSrc(meta?.icon ?? null);
                    return (
                      <button
                        key={st.agent_id}
                        type="button"
                        title={meta?.name ?? st.agent_id}
                        aria-label={meta?.name ?? st.agent_id}
                        aria-pressed={st.enabled}
                        onClick={() => void handleToggleAgent(skill, st.agent_id, !st.enabled)}
                        className={cn(
                          'p-0.5 rounded transition-all cursor-pointer hover:bg-bg-hover hover:ring-1 hover:ring-accent-blue/50 hover:scale-110',
                          !st.enabled && 'opacity-35 grayscale',
                        )}
                      >
                        {src ? (
                          <img src={src} alt="" className="w-4 h-4 rounded-[3px]" />
                        ) : (
                          <span className="inline-flex w-4 h-4 text-[9px] items-center justify-center bg-bg-hover rounded">
                            {(meta?.name ?? st.agent_id).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => openView(skill)}
                  className="shrink-0 text-[11px] font-medium text-accent-blue hover:brightness-110"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemove(skill)}
                  className="shrink-0 p-1 rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                  aria-label={`Remove ${skill.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {importOpen ? (
        <ImportToProjectDialog
          key={activeProject.id}
          open
          projectName={activeProject.name}
          agents={agents}
          librarySkills={librarySkills as ManagedSkillDto[]}
          tagGroups={tagGroups}
          existingSkillNames={existingNames}
          getSkillsForTagGroup={fetchGroupSkills}
          importing={importing}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="Remove skill from project?"
        description={
          pendingRemove ? (
            <p className="text-sm text-text-secondary">
              Remove <span className="font-medium text-text-primary">{pendingRemove.name}</span>{' '}
              from agent skill directories under{' '}
              <span className="font-medium text-text-primary">{activeProject.name}</span>? The
              Library copy is kept.
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

ProjectSkillContent.displayName = 'ProjectSkillContent';

export default ProjectSkillContent;
