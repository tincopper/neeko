import {
  Package,
  Download,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  RefreshCw,
  LayoutGrid,
  Pencil,
} from 'lucide-react';
import React, { useState, useCallback } from 'react';

import { useNotificationStore } from '@/features/notification/notificationStore';
import { useProjectStore } from '@/features/project/store';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import type { SkillView } from '@/shared/types';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';

interface NavItem {
  key: SkillView;
  label: string;
  icon: React.ElementType;
  count?: number;
}

/**
 * Skills left rail — structure inspired by Skills Manager:
 * primary nav + Tags (tag groups).
 */
const SkillsPanel: React.FC = React.memo(() => {
  const activeSkillView = useSkillStore((s) => s.activeSkillView);
  const skills = useSkillStore((s) => s.skills);
  const tagGroups = useSkillStore((s) => s.tagGroups);
  const activeTagGroupId = useSkillStore((s) => s.activeTagGroupId);
  const setActiveSkillView = useSkillStore((s) => s.setActiveSkillView);
  const setActiveTagGroupId = useSkillStore((s) => s.setActiveTagGroupId);
  const deleteTagGroup = useSkillStore((s) => s.deleteTagGroup);
  const updateTagGroup = useSkillStore((s) => s.updateTagGroup);
  const createTagGroup = useSkillStore((s) => s.createTagGroup);
  const syncTagGroup = useSkillStore((s) => s.syncTagGroup);

  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [presetsExpanded, setTagsExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'Skills',
      message,
    });
  }, []);

  const navItems: NavItem[] = [
    { key: 'local', label: 'Library', icon: Package, count: skills.length },
    { key: 'marketplace', label: 'Install Skills', icon: Download },
  ];

  const handleTagGroupSelect = useCallback(
    (id: string) => {
      setActiveTagGroupId(id === activeTagGroupId ? null : id);
      setActiveSkillView('local');
    },
    [activeTagGroupId, setActiveTagGroupId, setActiveSkillView],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createTagGroup(name);
      setNewName('');
      setCreating(false);
      toast(`Created preset "${name}"`);
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [newName, createTagGroup, toast]);

  const handleSync = useCallback(
    async (e: React.MouseEvent, id: string, name: string) => {
      e.stopPropagation();
      setSyncingId(id);
      try {
        await syncTagGroup(id);
        toast(`Synced "${name}" to agents`);
      } catch (err) {
        toast(String(err), 'error');
      } finally {
        setSyncingId(null);
      }
    },
    [syncTagGroup, toast],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
        await deleteTagGroup(id);
      } catch (err) {
        toast(String(err), 'error');
      }
    },
    [deleteTagGroup, toast],
  );

  const handleRenameStart = useCallback((e: React.MouseEvent, id: string, currentName: string) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const handleRenameSubmit = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      if (!name || name === tagGroups.find((t) => t.id === id)?.name) {
        setRenamingId(null);
        return;
      }
      try {
        await updateTagGroup(id, name);
        setRenamingId(null);
        toast(`Renamed to "${name}"`);
      } catch (err) {
        toast(String(err), 'error');
      }
    },
    [renameValue, tagGroups, updateTagGroup, toast],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 h-10 px-3 border-b border-border shrink-0">
        <LayoutGrid className="h-4 w-4 text-text-secondary shrink-0" />
        <span className="text-[var(--font-size)] font-semibold text-text-primary">Skills</span>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* Primary nav */}
        <nav className="py-2 px-1.5" aria-label="Skill views">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeSkillView === item.key && (item.key !== 'local' || activeTagGroupId === null);
            // Library stays "active looking" when a preset is selected too
            const librarySoft =
              item.key === 'local' && activeSkillView === 'local' && activeTagGroupId !== null;
            return (
              <button
                key={item.key}
                type="button"
                className={cn(
                  'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                  'text-[var(--font-size)]',
                  isActive
                    ? 'bg-bg-selected text-text-primary'
                    : librarySoft
                      ? 'text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                onClick={() => {
                  setActiveSkillView(item.key);
                  if (item.key === 'local') {
                    /* keep or clear preset? clear when clicking Library root */
                    setActiveTagGroupId(null);
                  } else {
                    setActiveTagGroupId(null);
                  }
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <span className="truncate flex-1 font-medium">{item.label}</span>
                {item.count !== undefined && (
                  <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Tags = Tag Groups */}
        <div className="border-t border-border mt-0.5 pt-1">
          <div className="flex items-center gap-1 px-3 py-1.5 select-none">
            <button
              type="button"
              className="flex items-center gap-1 flex-1 min-w-0 text-left"
              onClick={() => setTagsExpanded((v) => !v)}
            >
              {presetsExpanded ? (
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
              className="p-1 rounded-md text-text-muted hover:bg-white/[0.06] hover:text-text-primary transition-colors"
              title="New preset"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {presetsExpanded && (
            <div className="pb-2 px-1.5">
              {creating && (
                <div className="px-1.5 py-1 flex gap-1 items-center mb-0.5">
                  <input
                    autoFocus
                    className={cn(
                      'flex-1 min-w-0 h-7 px-2 text-[var(--font-size)] rounded-md',
                      'bg-bg-hover/60 border border-border text-text-primary',
                      'outline-none focus:border-border focus:bg-bg-primary placeholder:text-text-muted',
                    )}
                    placeholder="e.g. Backend"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreate();
                      if (e.key === 'Escape') {
                        setCreating(false);
                        setNewName('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="h-7 px-2.5 text-[11px] font-medium text-text-primary bg-bg-selected hover:bg-bg-hover rounded-md shrink-0 border border-border"
                    onClick={() => void handleCreate()}
                  >
                    Add
                  </button>
                </div>
              )}

              {tagGroups.map((tg) => {
                const active = activeTagGroupId === tg.id && activeSkillView === 'local';
                return (
                  <div
                    key={tg.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'group/row flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150',
                      'text-[var(--font-size)]',
                      active
                        ? 'bg-bg-selected text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    )}
                    onClick={() => handleTagGroupSelect(tg.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTagGroupSelect(tg.id);
                      }
                    }}
                  >
                    <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    {renamingId === tg.id ? (
                      <input
                        autoFocus
                        className={cn(
                          'flex-1 min-w-0 h-6 px-1.5 text-[var(--font-size)] rounded',
                          'bg-bg-hover/60 border border-border text-text-primary outline-none',
                        )}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameSubmit(tg.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => void handleRenameSubmit(tg.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate flex-1 font-medium">{tg.name}</span>
                    )}
                    <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                      {tg.skill_count}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity w-0 group-hover/row:w-auto overflow-hidden group-hover/row:overflow-visible">
                      <button
                        type="button"
                        onClick={(e) => void handleRenameStart(e, tg.id, tg.name)}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary"
                        title="Rename tag"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void handleSync(e, tg.id, tg.name)}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary"
                        title="Sync to agents"
                        disabled={syncingId === tg.id}
                      >
                        <RefreshCw
                          className={cn('h-3 w-3', syncingId === tg.id && 'animate-spin')}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void handleDelete(e, tg.id)}
                        className="p-0.5 rounded text-text-muted hover:text-red-400"
                        title="Delete tag"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {!creating && (
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Tag
                </button>
              )}

              {tagGroups.length === 0 && !creating && (
                <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
                  Group skills by role (Backend, Frontend…)
                </p>
              )}
            </div>
          )}
        </div>

        {/* Project list */}
        <div className="border-t border-border mt-0.5 pt-1">
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
            onClick={() => setProjectsExpanded((v) => !v)}
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
                  const isActive = activeProjectId === project.id;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => selectProject(project.id)}
                      className={cn(
                        'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                        'text-[var(--font-size)]',
                        isActive
                          ? 'bg-bg-selected text-text-primary'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                      )}
                    >
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={getAvatarStyle({ name: project.name, color: project.avatar_color })}
                      >
                        {getProjectInitials(project.name)}
                      </span>
                      <span className="truncate flex-1 font-medium">{project.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

SkillsPanel.displayName = 'SkillsPanel';

export default SkillsPanel;
