import React, { useState, useCallback } from 'react';
import { Package, Store, FolderOpen, ChevronDown, ChevronRight, Trash2, Plus, RefreshCw } from 'lucide-react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillView } from '@/shared/types';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/features/notification/notificationStore';

// ─── Nav items ───────────────────────────────────────────────────────────────

interface NavItem {
  key: SkillView;
  label: string;
  icon: React.ElementType;
  count?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Skills 侧栏导航（纯导航层，对标 ProjectsPanel 左侧侧栏）
 *
 * - view tabs：Local / Marketplace / Project
 * - Tag Groups：创建 / 选中过滤 / 同步 / 删除
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
    { key: 'local', label: 'Local Skills', icon: Package, count: skills.length },
    { key: 'marketplace', label: 'Marketplace', icon: Store },
    { key: 'project', label: 'Project Skills', icon: FolderOpen },
  ];

  const handleTagGroupSelect = useCallback(
    (id: string) => {
      setActiveTagGroupId(id === activeTagGroupId ? null : id);
      // Filtering applies in Local view
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
      <div className="flex items-center px-3 py-2 border-b border-border">
        <span className="text-[var(--font-size)] font-semibold text-text-primary">Skills</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <nav className="py-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeSkillView === item.key;
            return (
              <button
                key={item.key}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-[var(--font-size)] transition-colors text-left',
                  isActive ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover',
                )}
                onClick={() => setActiveSkillView(item.key)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className="text-text-muted">({item.count})</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border">
          <div className="flex items-center gap-1 px-3 py-1.5">
            <button
              className="flex items-center gap-1 flex-1 text-left text-[11px] font-medium text-text-muted uppercase tracking-wider hover:bg-bg-hover rounded"
              onClick={() => setTagGroupsExpanded(v => !v)}
            >
              {tagGroupsExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Tag Groups
            </button>
            <button
              className="p-0.5 text-text-muted hover:text-accent rounded"
              title="New tag group"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {tagGroupsExpanded && (
            <div className="pb-1">
              {creating && (
                <div className="px-3 py-1.5 flex gap-1">
                  <input
                    autoFocus
                    className="flex-1 min-w-0 bg-bg-primary border border-border rounded px-2 py-1 text-[var(--font-size)] text-text-primary outline-none focus:border-accent"
                    placeholder="Name (e.g. Backend)"
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
                    className="text-[11px] text-accent px-1.5 hover:bg-accent/15 rounded"
                    onClick={() => void handleCreate()}
                  >
                    Add
                  </button>
                </div>
              )}

              {tagGroups.map(tg => (
                <div
                  key={tg.id}
                  className={cn(
                    'flex items-center justify-between px-3 py-1.5 cursor-pointer text-[var(--font-size)] transition-colors group',
                    activeTagGroupId === tg.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-secondary hover:bg-bg-hover',
                  )}
                  onClick={() => handleTagGroupSelect(tg.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text-muted">{tg.icon ?? '📋'}</span>
                    <span className="truncate">{tg.name}</span>
                    <span className="text-text-muted">({tg.skill_count})</span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={e => void handleSync(e, tg.id, tg.name)}
                      className="text-text-muted hover:text-accent p-0.5"
                      title="Sync group to agents (install only)"
                      disabled={syncingId === tg.id}
                    >
                      <RefreshCw
                        className={cn('h-3 w-3', syncingId === tg.id && 'animate-spin')}
                      />
                    </button>
                    <button
                      onClick={e => void handleDelete(e, tg.id)}
                      className="text-text-muted hover:text-red-400 p-0.5"
                      title="Delete tag group"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
              {tagGroups.length === 0 && !creating && (
                <div className="px-3 py-2 text-[11px] text-text-muted">
                  No tag groups — click + to create
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
