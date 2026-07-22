import { LayoutGrid, Loader2, Settings2 } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';
import type { TagGroup } from '@/shared/types';
import { Button } from '@/ui';

interface BoundTagGroupsSectionProps {
  groups: TagGroup[];
  loading?: boolean;
  /** Currently selected group for list filter; null/undefined = show all. */
  activeGroupId?: string | null;
  /** Click a bound group chip to filter project skills (null clears filter). */
  onSelectGroup?: (groupId: string | null) => void;
  onManage: () => void;
  className?: string;
}

/**
 * Declaration-layer view: tag groups bound to the active project.
 * Chips can filter the disk skill list when `onSelectGroup` is provided.
 */
const BoundTagGroupsSection: React.FC<BoundTagGroupsSectionProps> = React.memo(
  ({ groups, loading = false, activeGroupId = null, onSelectGroup, onManage, className }) => {
    return (
      <section
        className={cn(
          'shrink-0 border-b border-border px-4 py-2.5',
          'bg-bg-secondary/30',
          className,
        )}
        data-testid="bound-tag-groups-section"
        aria-labelledby="bound-tag-groups-title"
      >
        <div className="flex items-center gap-2 mb-2">
          <h3
            id="bound-tag-groups-title"
            className="text-[10.5px] font-bold tracking-[0.08em] uppercase text-text-muted"
          >
            Bound Tag Groups
          </h3>
          <span className="flex-1" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onManage}
            className="h-7 px-2.5 text-[11px] gap-1.5 font-medium"
            data-testid="bound-tag-groups-manage"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Manage
          </Button>
        </div>

        {loading ? (
          <div
            className="flex items-center gap-2 py-2 text-text-muted text-[11px]"
            data-testid="bound-tag-groups-loading"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading bindings…
          </div>
        ) : groups.length === 0 ? (
          <p
            className="text-[11.5px] text-text-muted leading-relaxed py-1"
            data-testid="bound-tag-groups-empty"
          >
            No tag groups bound.
          </p>
        ) : (
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="bound-tag-groups-list"
            aria-label={`Bound tag groups (${groups.length})`}
          >
            {onSelectGroup ? (
              <li>
                <button
                  type="button"
                  onClick={() => onSelectGroup(null)}
                  aria-pressed={activeGroupId == null}
                  data-testid="bound-tag-group-filter-all"
                  className={cn(
                    'inline-flex items-center h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition-colors',
                    activeGroupId == null
                      ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/40'
                      : 'bg-bg-secondary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                >
                  All groups
                </button>
              </li>
            ) : null}
            {groups.map((g) => {
              const active = activeGroupId === g.id;
              const interactive = Boolean(onSelectGroup);
              const classNameChip = cn(
                'inline-flex items-center gap-1.5 h-7 px-2 rounded-md border text-[11.5px]',
                interactive && 'transition-colors cursor-pointer',
                active
                  ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/40 ring-1 ring-accent-blue/25'
                  : 'border-border bg-bg-secondary text-text-primary',
                interactive && !active && 'hover:bg-bg-hover',
              );
              const content = (
                <>
                  <LayoutGrid className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
                  <span className="font-medium truncate max-w-[10rem]">{g.name}</span>
                  <span className="tabular-nums text-text-muted text-[10.5px] shrink-0">
                    {g.skill_count}
                  </span>
                </>
              );
              return (
                <li key={g.id} data-testid={`bound-tag-group-${g.id}`}>
                  {interactive ? (
                    <button
                      type="button"
                      onClick={() => onSelectGroup?.(active ? null : g.id)}
                      aria-pressed={active}
                      title={
                        active ? `Clear filter: ${g.name}` : `Filter project skills by ${g.name}`
                      }
                      className={classNameChip}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={classNameChip}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  },
);

BoundTagGroupsSection.displayName = 'BoundTagGroupsSection';

export default BoundTagGroupsSection;
