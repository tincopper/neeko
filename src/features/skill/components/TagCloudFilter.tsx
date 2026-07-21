import React, { useMemo } from 'react';
import type { ManagedSkillDto } from '@/shared/types';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import { tagChipClass } from './skillTagColors';

interface TagCloudFilterProps {
  skills: ManagedSkillDto[];
}

const TagCloudFilter: React.FC<TagCloudFilterProps> = React.memo(({ skills }) => {
  const tagFilter = useSkillStore((s) => s.tagFilter);
  const toggleTagFilter = useSkillStore((s) => s.toggleTagFilter);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) {
      for (const t of s.tags) {
        if (t.trim()) set.add(t.trim());
      }
    }
    return Array.from(set).sort();
  }, [skills]);

  if (allTags.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border overflow-x-auto shrink-0 thin-scrollbar">
      <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted shrink-0 mr-0.5">
        Tags
      </span>
      {allTags.map((tag) => {
        const active = tagFilter.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTagFilter(tag)}
            className={cn(
              'shrink-0 inline-flex items-center text-[11px] leading-none px-2 py-1 rounded-md font-medium transition-all',
              active
                ? 'ring-1 ring-border ring-offset-[0.5px] ring-offset-bg-primary'
                : 'opacity-70 hover:opacity-100',
              tagChipClass(tag),
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
});

TagCloudFilter.displayName = 'TagCloudFilter';

export default TagCloudFilter;
