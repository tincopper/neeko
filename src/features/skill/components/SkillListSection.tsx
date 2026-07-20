import React from 'react';
import type { SkillListSectionProps } from './skillItemTypes';
import SkillCard from './SkillCard';
import { Package } from 'lucide-react';

const SKELETON_COUNT = 6;

const SkillRowSkeleton: React.FC = () => (
  <div className="flex items-center gap-2.5 pl-3 pr-2 py-2 mx-1.5 animate-pulse">
    <div className="w-7 h-7 rounded-md bg-bg-hover shrink-0" />
    <div className="flex-1 space-y-1.5 min-w-0">
      <div className="h-3 w-1/3 rounded bg-bg-hover" />
      <div className="h-2.5 w-2/3 rounded bg-bg-hover" />
    </div>
  </div>
);

/**
 * Skill list (dense rows). Filtering is done by the parent.
 */
const SkillListSection: React.FC<SkillListSectionProps> = React.memo(
  ({ skills, loading, selectedSkillId, actions, tagGroups = [] }) => {
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
        <div className="py-1">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkillRowSkeleton key={i} />
          ))}
        </div>
      );
    }

    if (skills.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center mb-3">
            <Package className="h-5 w-5 text-text-muted opacity-60" />
          </div>
          <p className="text-[var(--font-size)] text-text-secondary font-medium">No skills yet</p>
          <p className="text-[11px] text-text-muted mt-1 max-w-[240px] leading-relaxed">
            Create one, install from a directory or Git, or browse the Marketplace.
          </p>
        </div>
      );
    }

    return (
      <div className="py-1" role="list" aria-label={`Skills (${skills.length})`}>
        <div className="px-3 py-1.5 text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted">
          Library
          <span className="ml-1.5 font-medium tracking-normal normal-case text-text-muted/80">
            {skills.length}
          </span>
        </div>
        {skills.map(s => (
          <div key={s.id} role="listitem">
            <SkillCard
              skill={s}
              isSelected={selectedSkillId === s.id}
              tagGroups={tagGroups}
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
