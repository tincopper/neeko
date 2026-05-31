import React, { useState, useCallback } from 'react';
import { Package, Store, FolderOpen, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillView } from '@/shared/types';
import { cn } from '@/lib/utils';

// ─── Nav items ───────────────────────────────────────────────────────────────

interface NavItem {
  key: SkillView;
  label: string;
  icon: React.ElementType;
  count?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Skills 侧栏导航（纯导航层，对标 ProjectsPanel 左侧侧栏）�?
 *
 * 职责�?
 * - view tabs 导航（Local / Marketplace / Project�?
 * - Tag Groups 折叠区（选中后由 SkillContent 的内容区响应过滤�?
 *
 * 不负责：内容区渲染、dialog 管理（均�?SkillContent �?MainContent 内处理）�?
 */
const SkillsPanel: React.FC = React.memo(() => {
  const activeSkillView = useSkillStore(s => s.activeSkillView);
  const skills = useSkillStore(s => s.skills);
  const tagGroups = useSkillStore(s => s.tagGroups);
  const activeTagGroupId = useSkillStore(s => s.activeTagGroupId);
  const setActiveSkillView = useSkillStore(s => s.setActiveSkillView);
  const setActiveTagGroupId = useSkillStore(s => s.setActiveTagGroupId);
  const deleteTagGroup = useSkillStore(s => s.deleteTagGroup);

  const [tagGroupsExpanded, setTagGroupsExpanded] = useState(true);

  const navItems: NavItem[] = [
    { key: 'local', label: 'Local Skills', icon: Package, count: skills.length },
    { key: 'marketplace', label: 'Marketplace', icon: Store },
    { key: 'project', label: 'Project Skills', icon: FolderOpen },
  ];

  const handleTagGroupSelect = useCallback(
    (id: string) => {
      setActiveTagGroupId(id === activeTagGroupId ? null : id);
    },
    [activeTagGroupId, setActiveTagGroupId],
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center px-3 py-2 border-b border-border">
        <span className="text-[var(--font-size)] font-semibold text-text-primary">Skills</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── View nav ───────────────────────────────────────────────────────── */}
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

        {/* ── Tag Groups ─────────────────────────────────────────────────────── */}
        <div className="border-t border-border">
          <button
            className="flex items-center gap-1 px-3 py-1.5 w-full text-left text-[11px] font-medium text-text-muted uppercase tracking-wider hover:bg-bg-hover"
            onClick={() => setTagGroupsExpanded(v => !v)}
          >
            {tagGroupsExpanded
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
            Tag Groups
          </button>

          {tagGroupsExpanded && (
            <div className="pb-1">
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
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      deleteTagGroup(tg.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 p-0.5"
                    title="Delete tag group"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {tagGroups.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-text-muted">No tag groups</div>
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
