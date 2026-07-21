import { HardDrive, Loader2, Search, Store, X } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { ManagedSkillDto } from '@/shared/types';
import { getAgentIconSrc } from '@/shared/utils/agents';
import { Button, Checkbox } from '@/ui';

type SourceFilter = 'all' | 'local' | 'skillssh' | 'git';
type TagFilterMode = 'all' | 'untagged' | string;

interface ImportToAgentDialogProps {
  open: boolean;
  agentName: string;
  agentIcon: string | null;
  /** Library skills that are not yet on this agent */
  importableSkills: ManagedSkillDto[];
  importing?: boolean;
  onClose: () => void;
  onImport: (skillIds: string[]) => Promise<void>;
}

function sourceBadge(source: string): { label: string; className: string } {
  if (source === 'skillssh') {
    return {
      label: 'skills.sh',
      className: 'bg-bg-selected text-text-secondary border-border',
    };
  }
  if (source === 'git') {
    return {
      label: 'git',
      className: 'bg-bg-hover text-text-secondary border-border',
    };
  }
  return {
    label: 'library',
    className: 'bg-bg-hover text-text-secondary border-border',
  };
}

/**
 * Multi-select dialog: add Library skills to a selected agent.
 * Layout mirrors Skills Manager “Add from skill library”.
 *
 * Mount only when open (or remount via key) so local selection/filter state starts clean.
 */
const ImportToAgentDialog: React.FC<ImportToAgentDialogProps> = React.memo(
  ({ open, agentName, agentIcon, importableSkills, importing = false, onClose, onImport }) => {
    const [query, setQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [tagFilter, setTagFilter] = useState<TagFilterMode>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const allTags = useMemo(() => {
      const set = new Set<string>();
      for (const s of importableSkills) {
        for (const t of s.tags) {
          if (t.trim()) set.add(t.trim());
        }
      }
      return Array.from(set).sort();
    }, [importableSkills]);

    const filtered = useMemo(() => {
      let list = importableSkills;
      if (sourceFilter === 'local') {
        list = list.filter((s) => s.source_type === 'local' || s.source_type === 'import');
      } else if (sourceFilter !== 'all') {
        list = list.filter((s) => s.source_type === sourceFilter);
      }
      if (tagFilter === 'untagged') {
        list = list.filter((s) => s.tags.length === 0);
      } else if (tagFilter !== 'all') {
        list = list.filter((s) => s.tags.includes(tagFilter));
      }
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        list = list.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false) ||
            s.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      return list;
    }, [importableSkills, sourceFilter, tagFilter, query]);

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleConfirm = useCallback(async () => {
      if (selected.size === 0) return;
      setError(null);
      try {
        await onImport(Array.from(selected));
      } catch (e) {
        setError(String(e));
      }
    }, [selected, onImport]);

    if (!open) return null;

    const icon = getAgentIconSrc(agentIcon);
    const count = selected.size;

    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        data-testid="import-to-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-to-agent-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          className={cn(
            'relative w-full max-w-[480px] max-h-[min(80vh,640px)] flex flex-col',
            'bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
            <div className="min-w-0">
              <h2 id="import-to-agent-title" className="text-sm font-semibold text-text-primary">
                Add from Library
              </h2>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
                <span>Target</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bg-hover border border-border text-text-secondary">
                  {icon ? <img src={icon} alt="" className="h-3.5 w-3.5 rounded" /> : null}
                  <span className="font-medium text-text-primary">{agentName}</span>
                </span>
              </div>
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

          {/* Search */}
          <div className="px-4 pt-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search library…"
                className={cn(
                  'w-full h-9 pl-8 pr-3 text-[var(--font-size)] rounded-lg',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                )}
              />
            </div>
          </div>

          {/* Tag filter */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto thin-scrollbar shrink-0">
            <span className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-text-muted shrink-0">
              Tags
            </span>
            <FilterChip
              active={tagFilter === 'all'}
              onClick={() => setTagFilter('all')}
              label="All tags"
              accent
            />
            <FilterChip
              active={tagFilter === 'untagged'}
              onClick={() => setTagFilter('untagged')}
              label="Untagged"
              dashed
            />
            {allTags.map((tag) => (
              <FilterChip
                key={tag}
                active={tagFilter === tag}
                onClick={() => setTagFilter(tag)}
                label={tag}
              />
            ))}
          </div>

          {/* Source filter */}
          <div className="flex items-center gap-1.5 px-4 pb-2.5 border-b border-border shrink-0">
            <span className="text-[10.5px] font-bold tracking-[0.1em] uppercase text-text-muted shrink-0">
              Source
            </span>
            <FilterChip
              active={sourceFilter === 'local'}
              onClick={() => setSourceFilter(sourceFilter === 'local' ? 'all' : 'local')}
              label="Library"
              icon={<HardDrive className="h-3 w-3" />}
            />
            <FilterChip
              active={sourceFilter === 'skillssh'}
              onClick={() => setSourceFilter(sourceFilter === 'skillssh' ? 'all' : 'skillssh')}
              label="skills.sh"
              icon={<Store className="h-3 w-3" />}
            />
            <FilterChip
              active={sourceFilter === 'git'}
              onClick={() => setSourceFilter(sourceFilter === 'git' ? 'all' : 'git')}
              label="Git"
            />
          </div>

          {/* List */}
          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-text-muted">
                <p className="text-sm text-text-secondary">No matching skills</p>
                <p className="text-[11px] mt-1 max-w-[240px] leading-relaxed">
                  {importableSkills.length === 0
                    ? 'All library skills are already on this agent, or the library is empty.'
                    : 'Try another search or clear filters.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60" role="listbox" aria-multiselectable="true">
                {filtered.map((skill) => {
                  const checked = selected.has(skill.id);
                  const badge = sourceBadge(skill.source_type);
                  return (
                    <li key={skill.id}>
                      <div
                        role="option"
                        tabIndex={0}
                        aria-selected={checked}
                        onClick={() => toggle(skill.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggle(skill.id);
                          }
                        }}
                        className={cn(
                          'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer',
                          'hover:bg-bg-hover/60',
                          checked && 'bg-bg-hover/40',
                        )}
                      >
                        <span className="pt-0.5 shrink-0 pointer-events-none">
                          <Checkbox
                            checked={checked}
                            tabIndex={-1}
                            aria-hidden
                            aria-label={`Select ${skill.name}`}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-text-primary truncate">
                              {skill.name}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </div>
                          {skill.description ? (
                            <p className="text-[11px] text-text-muted line-clamp-2 mt-0.5 leading-relaxed">
                              {skill.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
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

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border shrink-0">
            <Button
              type="button"
              variant="primary"
              disabled={count === 0 || importing}
              onClick={() => void handleConfirm()}
              className="w-full h-10 rounded-lg text-sm font-medium gap-2"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {count === 0
                ? `Select skills to add to ${agentName}`
                : `Add ${count} skill${count === 1 ? '' : 's'} to ${agentName}`}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

ImportToAgentDialog.displayName = 'ImportToAgentDialog';

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  accent?: boolean;
  dashed?: boolean;
}

const FilterChip: React.FC<FilterChipProps> = ({
  active,
  onClick,
  label,
  icon,
  accent,
  dashed,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-full font-medium transition-colors border',
      active
        ? accent
          ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/35'
          : 'bg-bg-selected text-text-primary border-border'
        : dashed
          ? 'border-dashed border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover'
          : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary',
    )}
  >
    {icon}
    {label}
  </button>
);

export default ImportToAgentDialog;
