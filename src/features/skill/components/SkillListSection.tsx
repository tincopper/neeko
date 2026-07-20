import React from 'react';
import type { SkillListSectionProps } from './skillItemTypes';
import SkillCard from './SkillCard';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const SKELETON_COUNT = 6;

const SkillCardSkeleton: React.FC = () => (
  <div className="rounded-lg border border-border bg-bg-primary p-3 flex flex-col gap-2 animate-pulse min-h-[148px]">
    <div className="flex gap-2">
      <div className="w-4 h-4 rounded-full bg-bg-hover" />
      <div className="h-3.5 w-1/2 rounded bg-bg-hover" />
    </div>
    <div className="h-2.5 w-full rounded bg-bg-hover" />
    <div className="h-2.5 w-2/3 rounded bg-bg-hover" />
    <div className="flex gap-1 mt-auto pt-2">
      <div className="h-4 w-12 rounded-full bg-bg-hover" />
      <div className="h-4 w-10 rounded-full bg-bg-hover" />
    </div>
  </div>
);

export interface SkillListSectionExtraProps {
  presetLabel?: string | null;
}

/**
 * Skill card grid — 2–3 columns, Skills Manager style layout.
 */
const SkillListSection: React.FC<SkillListSectionProps & SkillListSectionExtraProps> = React.memo(
  ({ skills, loading, selectedSkillId, actions, tagGroups = [], presetLabel }) => {
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
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkillCardSkeleton key={i} />
          ))}
        </div>
      );
    }

    if (skills.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-11 h-11 rounded-xl bg-bg-hover flex items-center justify-center mb-3">
            <Package className="h-5 w-5 text-text-muted opacity-60" />
          </div>
          <p className="text-[var(--font-size)] text-text-secondary font-medium">No skills yet</p>
          <p className="text-[11px] text-text-muted mt-1 max-w-[260px] leading-relaxed">
            Create one, install from a directory or Git, or browse Install Skills.
          </p>
        </div>
      );
    }

    return (
      <div
        className={cn('p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 content-start')}
        role="list"
        aria-label={`Skills (${skills.length})`}
      >
        {skills.map(s => (
          <div key={s.id} role="listitem">
            <SkillCard
              skill={s}
              isSelected={selectedSkillId === s.id}
              tagGroups={tagGroups}
              presetLabel={presetLabel}
              onSelect={() => onSelectSkill(s.id === selectedSkillId ? null : s.id)}
              onAddToTagGroup={
                onAddToTagGroup ? tagGroupId => onAddToTagGroup(s.id, tagGroupId) : undefined
              }
              onCheckUpdate={onCheckUpdate ? () => onCheckUpdate(s) : undefined}
              onUpdateSkill={onUpdateSkill ? () => onUpdateSkill(s) : undefined}
              onAction={action => {
                if (action === 'delete') onDeleteSkill(s.id);
                else if (action === 'edit') onEditSkill(s);
                else if (action === 'detail') onViewSkill(s);
              }}
            />
          </div>
        ))}
      </div>
    );
  },
);

SkillListSection.displayName = 'SkillListSection';

export default SkillListSection;
