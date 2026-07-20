import React, { useState, useCallback } from 'react';
import {
  Package,
  Store,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  RefreshCw,
  Tags,
} from 'lucide-react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillView } from '@/shared/types';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/features/notification/notificationStore';

interface NavItem {
  key: SkillView;
  label: string;
  icon: React.ElementType;
  count?: number;
}

/**
 * Skills left rail — same density as ProjectsPanel.
 */
const SkillsPanel: React.FC = React.memo(() => {
  const activeSkillView = useSkillStore(s => s.activeSkillView);
  const skills = useSkillStore(s => s.skills);
  const tagGroups = useSkillStore(s => s.tagGroups);
  const activeTagGroupId = useSkillStore(s => s.activeTagGroupId);
  const setActiveSkillView = useSkillStore(s => s.setActiveSkillView);
  const setActiveTagGroupId = useSkillStore(s => s.setActiveTagGroupId);
  const deleteTagGroup = useSkillStore(s => s.deleteTagGroup);
  const createTagGroup = useSkillStore(s => s.createTagGroup);
  const syncTagGroup = useSkillStore(s => s.syncTagGroup);

  const [tagGroupsExpanded, setTagGroupsExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'Skills',
      message,
    });
  }, []);

  const navItems: NavItem[] = [
    { key: 'local', label: 'Library', icon: Package, count: skills.length },
    { key: 'marketplace', label: 'Marketplace', icon: Store },
    { key: 'project', label: 'Project', icon: FolderOpen },
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
      toast(`Created tag group "${name}"`);
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-9 px-3 border-b border-border shrink-0">
        <span className="text-[var(--font-size)] font-semibold text-text-primary">Skills</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <nav className="py-1.5" aria-label="Skill views">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeSkillView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={cn(
                  'flex items-center gap-2 w-full mx-0 px-3 py-1.5 text-left transition-colors duration-150',
                  'text-[var(--font-size)]',
                  isActive
                    ? 'bg-accent/12 text-accent'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                onClick={() => {
                  setActiveSkillView(item.key);
                  if (item.key !== 'local') setActiveTagGroupId(null);
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <span className="truncate flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span
                    className={cn(
                      'text-[10.5px] tabular-nums',
                      isActive ? 'text-accent/80' : 'text-text-muted',
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border mt-0.5">
          <div className="group flex items-center gap-1 px-3 pt-3 pb-1 select-none">
            <button
              type="button"
              className="flex items-center gap-1 flex-1 min-w-0 text-left"
              onClick={() => setTagGroupsExpanded(v => !v)}
            >
              {tagGroupsExpanded ? (
                <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
              )}
              <Tags className="h-3 w-3 text-text-muted shrink-0 opacity-80" />
              <span className="text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted">
                Tag Groups
              </span>
              <span className="text-[10.5px] text-text-muted">({tagGroups.length})</span>
            </button>
            <button
              type="button"
              className="p-1 rounded-md text-text-muted hover:bg-white/[0.06] hover:text-text-primary transition-colors"
              title="New tag group"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {tagGroupsExpanded && (
            <div className="pb-2">
              {creating && (
                <div className="px-3 py-1 flex gap-1 items-center">
                  <input
                    autoFocus
                    className={cn(
                      'flex-1 min-w-0 h-7 px-2 text-[var(--font-size)] rounded-md',
                      'bg-bg-hover/60 border border-border text-text-primary',
                      'outline-none focus:border-accent/50 placeholder:text-text-muted',
                    )}
                    placeholder="e.g. Backend"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void handleCreate();
                      if (e.key === 'Escape') {
                        setCreating(false);
                        setNewName('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="h-7 px-2 text-[11px] text-accent hover:bg-accent/15 rounded-md shrink-0"
                    onClick={() => void handleCreate()}
                  >
                    Add
                  </button>
                </div>
              )}

              {tagGroups.map(tg => {
                const active = activeTagGroupId === tg.id;
                return (
                  <div
                    key={tg.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'group/row flex items-center justify-between gap-1 pl-6 pr-2 py-1.5 mx-1.5 rounded-md cursor-pointer transition-colors duration-150',
                      'text-[var(--font-size)]',
                      active
                        ? 'bg-accent/12 text-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    )}
                    onClick={() => handleTagGroupSelect(tg.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTagGroupSelect(tg.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{tg.name}</span>
                      <span
                        className={cn(
                          'text-[10.5px] tabular-nums',
                          active ? 'text-accent/70' : 'text-text-muted',
                        )}
                      >
                        {tg.skill_count}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={e => void handleSync(e, tg.id, tg.name)}
                        className="p-1 rounded-md text-text-muted hover:text-accent hover:bg-white/[0.06]"
                        title="Sync group to agents"
                        disabled={syncingId === tg.id}
                      >
                        <RefreshCw
                          className={cn('h-3 w-3', syncingId === tg.id && 'animate-spin')}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={e => void handleDelete(e, tg.id)}
                        className="p-1 rounded-md text-text-muted hover:text-red-400 hover:bg-white/[0.06]"
                        title="Delete tag group"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {tagGroups.length === 0 && !creating && (
                <div className="px-6 py-2 text-[11px] text-text-muted leading-relaxed">
                  No groups yet. Click + to create Backend, Frontend, …
                </div>
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
