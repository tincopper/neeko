import { Check, Loader2 } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { TagGroup } from '@/shared/types';

export interface TagGroupChipPickerProps {
  tagGroups: TagGroup[];
  /** Currently selected ids (controlled). */
  selectedIds: string[];
  /** Originally bound ids — used to detect dirty state. */
  boundIds?: string[];
  loading?: boolean;
  saving?: boolean;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
  onApply: () => void;
  onViewInSkills?: () => void;
  className?: string;
}

/**
 * Guided multi-select chips for project ↔ tag-group binding (onboarding).
 * Presentational: selection + apply; bind/open-skills live in the parent.
 */
const TagGroupChipPicker: React.FC<TagGroupChipPickerProps> = React.memo(
  ({
    tagGroups,
    selectedIds,
    boundIds = [],
    loading = false,
    saving = false,
    disabled = false,
    onChange,
    onApply,
    onViewInSkills,
    className,
  }) => {
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const bound = useMemo(() => new Set(boundIds), [boundIds]);

    const dirty = useMemo(() => {
      if (selectedIds.length !== boundIds.length) return true;
      return selectedIds.some((id) => !bound.has(id));
    }, [selectedIds, boundIds, bound]);

    const skillEstimate = useMemo(() => {
      let n = 0;
      for (const g of tagGroups) {
        if (selected.has(g.id)) n += g.skill_count ?? 0;
      }
      return n;
    }, [tagGroups, selected]);

    const toggle = useCallback(
      (id: string) => {
        if (disabled || saving) return;
        if (selected.has(id)) {
          onChange(selectedIds.filter((x) => x !== id));
        } else {
          onChange([...selectedIds, id]);
        }
      },
      [disabled, saving, selected, selectedIds, onChange],
    );

    if (loading) {
      return (
        <div
          className={cn('flex items-center gap-2 py-2 text-[12px] text-text-muted', className)}
          data-testid="tag-group-chip-picker-loading"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading tag groups…
        </div>
      );
    }

    if (tagGroups.length === 0) {
      return (
        <div className={cn('space-y-2 py-1', className)} data-testid="tag-group-chip-picker-empty">
          <p className="text-[12px] text-text-muted m-0">
            No tag groups yet. Create one in Skills, then bind it here.
          </p>
          {onViewInSkills && (
            <button
              type="button"
              className="text-[12px] text-accent-blue bg-transparent border-none cursor-pointer font-medium hover:underline p-0"
              onClick={onViewInSkills}
            >
              Open Skills to create →
            </button>
          )}
        </div>
      );
    }

    const sorted = [...tagGroups].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );

    return (
      <div className={cn('space-y-2.5', className)} data-testid="tag-group-chip-picker">
        <ul
          className="flex flex-wrap gap-1.5 list-none m-0 p-0"
          role="listbox"
          aria-multiselectable
        >
          {sorted.map((g) => {
            const isOn = selected.has(g.id);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isOn}
                  disabled={disabled || saving}
                  onClick={() => toggle(g.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                    isOn
                      ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue'
                      : 'border-border bg-bg-primary text-text-secondary hover:border-border hover:bg-bg-hover',
                    (disabled || saving) && 'opacity-60 cursor-not-allowed',
                  )}
                  data-testid={`tag-group-chip-${g.id}`}
                >
                  {isOn && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
                  <span className="truncate max-w-[140px]">{g.name}</span>
                  <span
                    className={cn('tabular-nums', isOn ? 'text-accent-blue/80' : 'text-text-muted')}
                  >
                    {g.skill_count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
          <p className="text-[11px] text-text-muted m-0">
            {selectedIds.length === 0
              ? 'No groups selected'
              : `Selected ${selectedIds.length} group${selectedIds.length === 1 ? '' : 's'} · ~${skillEstimate} skill${skillEstimate === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-3">
            {onViewInSkills && (
              <button
                type="button"
                className="text-[12px] text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer p-0 transition-colors"
                onClick={onViewInSkills}
                data-testid="tag-group-view-skills"
              >
                View in Skills →
              </button>
            )}
            <button
              type="button"
              disabled={!dirty || saving || disabled}
              onClick={onApply}
              data-testid="tag-group-apply"
              className={cn(
                'inline-flex items-center gap-1 text-[12px] font-medium bg-transparent border-none cursor-pointer p-0 transition-colors',
                dirty && !saving && !disabled
                  ? 'text-accent-blue hover:underline'
                  : 'text-text-muted opacity-50 cursor-not-allowed',
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Binding…
                </>
              ) : (
                'Apply binding'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  },
);

TagGroupChipPicker.displayName = 'TagGroupChipPicker';
export default TagGroupChipPicker;
