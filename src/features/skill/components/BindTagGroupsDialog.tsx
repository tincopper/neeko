import { Check, Loader2, Search, X } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { TagGroup } from '@/shared/types';
import { Button } from '@/ui';

interface BindTagGroupsDialogProps {
  open: boolean;
  projectName: string;
  tagGroups: TagGroup[];
  /** Currently bound tag group ids */
  boundIds: string[];
  saving?: boolean;
  onClose: () => void;
  onSave: (tagGroupIds: string[]) => Promise<void>;
}

/**
 * Multi-select tag groups to bind to a project (Add Skill flow).
 */
const BindTagGroupsDialog: React.FC<BindTagGroupsDialogProps> = React.memo(
  ({ open, projectName, tagGroups, boundIds, saving = false, onClose, onSave }) => {
    // Parent remounts with key when opening so boundIds seed cleanly
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Set<string>>(() => new Set(boundIds));
    const [error, setError] = useState<string | null>(null);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return tagGroups;
      return tagGroups.filter((g) => g.name.toLowerCase().includes(q));
    }, [tagGroups, query]);

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleSave = useCallback(async () => {
      setError(null);
      try {
        await onSave(Array.from(selected));
      } catch (e) {
        setError(String(e));
      }
    }, [selected, onSave]);

    if (!open) return null;

    const count = selected.size;

    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        data-testid="bind-tag-groups-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bind-tag-groups-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          className={cn(
            'relative w-full max-w-[440px] max-h-[min(80vh,560px)] flex flex-col',
            'bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden',
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
            <div className="min-w-0">
              <h2 id="bind-tag-groups-title" className="text-sm font-semibold text-text-primary">
                Bind tag groups
              </h2>
              <p className="text-[11px] text-text-muted mt-1 truncate">
                Skills in selected groups load for{' '}
                <span className="text-text-secondary font-medium">{projectName}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 pt-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tag groups…"
                className={cn(
                  'w-full h-9 pl-8 pr-3 text-[var(--font-size)] rounded-lg',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                )}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar mt-2 border-t border-border">
            {tagGroups.length === 0 ? (
              <div className="px-4 py-10 text-center text-text-muted text-sm">
                No tag groups yet. Create one in the Skills sidebar.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-text-muted text-sm">
                No matching groups
              </div>
            ) : (
              <ul>
                {filtered.map((tg) => {
                  const checked = selected.has(tg.id);
                  return (
                    <li key={tg.id}>
                      <button
                        type="button"
                        onClick={() => toggle(tg.id)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          'hover:bg-bg-hover/60',
                          checked && 'bg-bg-hover/40',
                        )}
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                            checked
                              ? 'bg-accent-blue/15 border-accent-blue text-accent-blue'
                              : 'border-border bg-transparent',
                          )}
                        >
                          {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
                          {tg.name}
                        </span>
                        <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                          {tg.skill_count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error ? (
            <div className="px-4 py-2 text-xs text-accent-red bg-accent-red/10 border-t border-accent-red/20 shrink-0">
              {error}
            </div>
          ) : null}

          <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 h-9"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="flex-1 h-9 gap-1.5"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {count === 0 ? 'Clear bindings' : `Bind ${count} group${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

BindTagGroupsDialog.displayName = 'BindTagGroupsDialog';

export default BindTagGroupsDialog;
