import { Package } from 'lucide-react';
import React from 'react';

import SkillCard from './SkillCard';
import type { SkillListSectionProps } from './skillItemTypes';

const SKELETON_COUNT = 6;

const SkillCardSkeleton: React.FC = () => (
  <div className="rounded-lg border border-border bg-bg-primary p-3.5 flex flex-col gap-2.5 animate-pulse min-h-[160px]">
    <div className="h-3.5 w-2/5 rounded bg-bg-hover" />
    <div className="space-y-1.5">
      <div className="h-2.5 w-full rounded bg-bg-hover" />
      <div className="h-2.5 w-3/4 rounded bg-bg-hover" />
    </div>
    <div className="flex gap-1.5">
      <div className="h-5 w-14 rounded-md bg-bg-hover" />
      <div className="h-5 w-12 rounded-md bg-bg-hover" />
    </div>
    <div className="mt-auto pt-2 border-t border-border flex justify-between">
      <div className="h-2.5 w-20 rounded bg-bg-hover" />
      <div className="h-2.5 w-12 rounded bg-bg-hover" />
    </div>
  </div>
);

export interface SkillListSectionExtraProps {
  /** Active tag-group filter label shown on cards. */
  tagGroupLabel?: string | null;
  /** skillId → tag-group names for badge fallback. */
  skillTagGroupMap?: Record<string, string[]>;
  agents?: Array<{ id: string; icon: string | null; name: string }>;
}

/**
 * 3-column skill card grid (Skills Manager reference).
 */
const SkillListSection: React.FC<SkillListSectionProps & SkillListSectionExtraProps> = React.memo(
  ({
    skills,
    loading,
    selectedSkillId,
    actions,
    tagGroups = [],
    tagGroupLabel,
    skillTagGroupMap = {},
    agents = [],
    onDescriptionResolved,
    onTagClick,
  }) => {
    const {
      onSelectSkill,
      onEditSkill,
      onViewSkill,
      onDeleteSkill,
      onAddToTagGroup,
      onCheckUpdate,
      onUpdateSkill,
    } = actions;

    if (loading) {
      return (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkillCardSkeleton key={i} />
          ))}
        </div>
      );
    }

    if (skills.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="w-11 h-11 rounded-xl bg-bg-hover flex items-center justify-center mb-3">
            <Package className="h-5 w-5 text-text-muted opacity-60" />
          </div>
          <p className="text-[var(--font-size)] text-text-secondary font-medium">No skills yet</p>
          <p className="text-[11px] text-text-muted mt-1 max-w-[260px] leading-relaxed">
            Create one, install from a directory or Git, or open Marketplace.
          </p>
        </div>
      );
    }

    return (
      <div
        className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start"
        role="list"
        aria-label={`Skills (${skills.length})`}
      >
        {skills.map((s) => {
          const groups = skillTagGroupMap[s.id];
          const cardTagGroupLabel =
            tagGroupLabel ?? (groups && groups.length > 0 ? groups[0] : null);
          return (
            <div key={s.id} role="listitem" className="min-w-0 h-full">
              <SkillCard
                skill={s}
                isSelected={selectedSkillId === s.id}
                tagGroups={tagGroups}
                agents={agents}
                tagGroupLabel={cardTagGroupLabel}
                onDescriptionResolved={onDescriptionResolved}
                onTagClick={onTagClick}
                onSelect={() => onSelectSkill(s.id === selectedSkillId ? null : s.id)}
                onAddToTagGroup={
                  onAddToTagGroup ? (tagGroupId) => onAddToTagGroup(s.id, tagGroupId) : undefined
                }
                onCheckUpdate={onCheckUpdate ? () => onCheckUpdate(s) : undefined}
                onUpdateSkill={onUpdateSkill ? () => onUpdateSkill(s) : undefined}
                onAction={(action) => {
                  if (action === 'delete') onDeleteSkill(s.id);
                  else if (action === 'edit') onEditSkill(s);
                  else if (action === 'detail') onViewSkill(s);
                }}
              />
            </div>
          );
        })}
      </div>
    );
  },
);

SkillListSection.displayName = 'SkillListSection';

export default SkillListSection;
