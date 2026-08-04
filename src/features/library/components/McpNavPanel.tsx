/* eslint-disable jsx-a11y/no-autofocus */
import {
  Package,
  Download,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  LayoutGrid,
  Pencil,
  Terminal,
} from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- need agent icon resolution
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';

const McpNavPanel: React.FC = React.memo(() => {
  const mcpView = useMcpStore((s) => s.mcpView);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const mcpServers = useMcpStore((s) => s.mcpServers);
  const mcpTagGroups = useMcpStore((s) => s.mcpTagGroups);
  const activeMcpTagGroup = useMcpStore((s) => s.activeMcpTagGroup);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const setActiveMcpAgentId = useMcpStore((s) => s.setActiveMcpAgentId);
  const setActiveMcpProjectId = useMcpStore((s) => s.setActiveMcpProjectId);
  const refreshMcpTagGroups = useMcpStore((s) => s.refreshMcpTagGroups);
  const createMcpTagGroup = useMcpStore((s) => s.createMcpTagGroup);
  const deleteMcpTagGroup = useMcpStore((s) => s.deleteMcpTagGroup);
  const updateMcpTagGroup = useMcpStore((s) => s.updateMcpTagGroup);

  const agentGroups = useSkillStore((s) => s.agentSkillGroups);
  const refreshAgentSkills = useSkillStore((s) => s.refreshAgentSkills);
  const projectSkillCounts = useSkillStore((s) => s.projectSkillCounts);
  const projectSkillCountsLoading = useSkillStore((s) => s.projectSkillCountsLoading);
  const projectSkillCountsError = useSkillStore((s) => s.projectSkillCountsError);
  const projectTagGroupCounts = useSkillStore((s) => s.projectTagGroupCounts);
  const projectTagGroupCountsLoading = useSkillStore((s) => s.projectTagGroupCountsLoading);
  const projectTagGroupCountsError = useSkillStore((s) => s.projectTagGroupCountsError);
  const refreshProjectSkillCounts = useSkillStore((s) => s.refreshProjectSkillCounts);
  const refreshProjectTagGroupCounts = useSkillStore((s) => s.refreshProjectTagGroupCounts);

  const projects = useProjectStore((s) => s.projects);
  const projectsKey = React.useMemo(
    () => projects.map((p) => `${p.id}:${p.path}`).join('\n'),
    [projects],
  );

  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'MCP',
      message,
    });
  }, []);

  useEffect(() => {
    void refreshMcpTagGroups();
  }, [refreshMcpTagGroups]);

  useEffect(() => {
    void refreshAgentSkills().catch((e) => {
      toast(`Failed to load agent data: ${String(e)}`, 'error');
    });
  }, [refreshAgentSkills, toast]);

  useEffect(() => {
    void refreshProjectSkillCounts().catch((e) => {
      toast(`Failed to load project counts: ${String(e)}`, 'error');
    });
    void refreshProjectTagGroupCounts().catch((e) => {
      toast(`Failed to load project tag group counts: ${String(e)}`, 'error');
    });
  }, [projectsKey, refreshProjectSkillCounts, refreshProjectTagGroupCounts, toast]);

  const handleTagGroupSelect = useCallback(
    (id: string) => {
      setActiveMcpTagGroup(activeMcpTagGroup === id ? null : id);
      setMcpView('installed');
    },
    [activeMcpTagGroup, setActiveMcpTagGroup, setMcpView],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMcpTagGroup({ name });
      setCreating(false);
      setNewName('');
    } catch (e) {
      toast(`Failed to create tag group: ${String(e)}`, 'error');
    }
  }, [newName, createMcpTagGroup, toast]);

  const handleRename = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      if (!name) return;
      try {
        await updateMcpTagGroup(id, { name });
        setRenamingId(null);
        setRenameValue('');
      } catch (e) {
        toast(`Failed to rename tag group: ${String(e)}`, 'error');
      }
    },
    [renameValue, updateMcpTagGroup, toast],
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteMcpTagGroup(pendingDeleteId);
      if (activeMcpTagGroup === pendingDeleteId) {
        setActiveMcpTagGroup(null);
      }
      setPendingDeleteId(null);
    } catch (e) {
      toast(`Failed to delete tag group: ${String(e)}`, 'error');
    }
  }, [pendingDeleteId, deleteMcpTagGroup, activeMcpTagGroup, setActiveMcpTagGroup, toast]);

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      setActiveMcpAgentId(agentId);
      setActiveMcpTagGroup(null);
      setMcpView('agent');
    },
    [setActiveMcpAgentId, setActiveMcpTagGroup, setMcpView],
  );

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      setActiveMcpProjectId(projectId);
      setActiveMcpTagGroup(null);
      setMcpView('project');
    },
    [setActiveMcpProjectId, setActiveMcpTagGroup, setMcpView],
  );

  return (
    <nav className="py-2 px-1.5" aria-label="MCP views">
      <button
        type="button"
        className={cn(
          'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
          mcpView === 'installed'
            ? 'bg-bg-selected text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={() => setMcpView('installed')}
      >
        <Package className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate flex-1 font-medium">Installed</span>
        <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
          {mcpServers.length}
        </span>
      </button>
      <button
        type="button"
        className={cn(
          'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
          mcpView === 'marketplace'
            ? 'bg-bg-selected text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={() => setMcpView('marketplace')}
      >
        <Download className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate flex-1 font-medium">Marketplace</span>
      </button>

      <div className="border-t border-border mt-0.5 pt-1">
        <div className="flex items-center gap-1 px-3 py-1.5 select-none">
          <button
            type="button"
            className="flex items-center gap-1 flex-1 min-w-0 text-left"
            onClick={() => setTagsExpanded(!tagsExpanded)}
          >
            {tagsExpanded ? (
              <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
            )}
            <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
              Tags
            </span>
          </button>
          <button
            type="button"
            className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title="New tag group"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {tagsExpanded && (
          <div className="pb-2 px-1.5">
            {creating && (
              <div className="px-2.5 py-1.5">
                <input
                  autoFocus
                  className={cn(
                    'w-full h-7 px-2 text-[var(--font-size)] rounded-md',
                    'bg-bg-primary border border-border text-text-primary',
                    'outline-none focus:border-accent-blue',
                  )}
                  placeholder="Tag group name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  onBlur={() => {
                    if (!newName.trim()) {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                />
              </div>
            )}
            {mcpTagGroups.length === 0 && !creating && (
              <p className="px-2.5 py-2 text-[11px] text-text-muted leading-snug">
                Group servers by role (Backend, Frontend...)
              </p>
            )}
            {mcpTagGroups.map((group) => (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                className={cn(
                  'group/row flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150',
                  activeMcpTagGroup === group.id
                    ? 'bg-bg-selected text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                onClick={() => handleTagGroupSelect(group.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTagGroupSelect(group.id);
                }}
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />
                {renamingId === group.id ? (
                  <input
                    autoFocus
                    className={cn(
                      'flex-1 h-6 px-1.5 text-[var(--font-size)] rounded',
                      'bg-bg-primary border border-border text-text-primary',
                      'outline-none focus:border-accent-blue',
                    )}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(group.id);
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                    onBlur={() => {
                      if (renameValue.trim() && renameValue.trim() !== group.name) {
                        void handleRename(group.id);
                      } else {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate flex-1 font-medium">{group.name}</span>
                )}
                <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                  {group.serverCount}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity w-0 group-hover/row:w-auto overflow-hidden group-hover/row:overflow-visible">
                  <button
                    type="button"
                    className="p-0.5 rounded text-text-muted hover:text-text-primary"
                    title="Rename tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(group.id);
                      setRenameValue(group.name);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 rounded text-text-muted hover:text-accent-red"
                    title="Delete tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(group.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
            {mcpTagGroups.length > 0 && !creating && (
              <button
                type="button"
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New Tag
              </button>
            )}
          </div>
        )}
      </div>

      {/* Agents section */}
      <div className="border-t border-border mt-0.5 pt-1">
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
          onClick={() => setAgentsExpanded(!agentsExpanded)}
        >
          {agentsExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Agents
          </span>
        </button>
        {agentsExpanded && (
          <div className="pb-1 px-1.5">
            {agentGroups.length === 0 ? (
              <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
                No agents configured.
              </p>
            ) : (
              agentGroups.map((group) => {
                const icon = resolveAgentIconSrc(group.agent_icon);
                const isActive =
                  mcpView === 'agent' && group.agent_id === useMcpStore.getState().activeMcpAgentId;
                return (
                  <button
                    key={group.agent_id}
                    type="button"
                    onClick={() => handleAgentSelect(group.agent_id)}
                    className={cn(
                      'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                      'text-[var(--font-size)]',
                      isActive
                        ? 'bg-bg-selected text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    )}
                  >
                    {icon ? (
                      <img src={icon} alt="" className="h-4 w-4 rounded shrink-0" />
                    ) : (
                      <Terminal className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    )}
                    <span className="truncate flex-1 font-medium">{group.agent_name}</span>
                    {!group.agent_enabled && (
                      <span className="text-[10px] text-text-muted">disabled</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Projects section */}
      <div className="border-t border-border mt-0.5 pt-1">
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
          onClick={() => setProjectsExpanded(!projectsExpanded)}
        >
          {projectsExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Projects
          </span>
        </button>
        {projectsExpanded && (
          <div className="pb-1 px-1.5">
            {projects.length === 0 ? (
              <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
                No projects loaded.
              </p>
            ) : (
              projects.map((project) => {
                const avatarStyle = getAvatarStyle({
                  name: project.name,
                  color: (project as any).avatar_color,
                });
                const initials = getProjectInitials(project.name);
                const diskCount = projectSkillCounts.get(project.id);
                const groupCount = projectTagGroupCounts.get(project.id);
                const diskLabel = projectSkillCountsError
                  ? '?'
                  : projectSkillCountsLoading && diskCount === undefined
                    ? '...'
                    : (diskCount ?? 0);
                const groupLabel = projectTagGroupCountsError
                  ? '?'
                  : projectTagGroupCountsLoading && groupCount === undefined
                    ? '...'
                    : (groupCount ?? 0);
                const isActive =
                  mcpView === 'project' && project.id === useMcpStore.getState().activeMcpProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleProjectSelect(project.id)}
                    className={cn(
                      'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                      'text-[var(--font-size)]',
                      isActive
                        ? 'bg-bg-selected text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    )}
                  >
                    <span
                      className="flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold shrink-0"
                      style={avatarStyle}
                    >
                      {initials}
                    </span>
                    <span className="truncate flex-1 font-medium">{project.name}</span>
                    <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                      {diskLabel}·{groupLabel}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          open
          onOpenChange={(v) => {
            if (!v) setPendingDeleteId(null);
          }}
          title="Delete Tag Group"
          description="Are you sure you want to delete this tag group? Servers in the group will not be deleted."
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
        />
      )}
    </nav>
  );
});

McpNavPanel.displayName = 'McpNavPanel';

export default McpNavPanel;
