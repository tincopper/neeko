import { Check, HardDrive, Loader2, Search, Store, X } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- custom agent icons
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { cn } from '@/lib/utils';
import type { ManagedSkillDto, TagGroup } from '@/shared/types';
import { Button, Checkbox } from '@/ui';

type PickMode = 'skills' | 'tag-groups';
type SourceFilter = 'all' | 'local' | 'skillssh' | 'git';
type TagFilterMode = 'all' | 'untagged' | string;

export interface ProjectAgentOption {
  id: string;
  name: string;
  icon: string | null;
  /** Whether this agent has a known project-relative skills dir */
  projectCapable: boolean;
}

interface ImportToProjectDialogProps {
  open: boolean;
  projectName: string;
  agents: ProjectAgentOption[];
  librarySkills: ManagedSkillDto[];
  tagGroups: TagGroup[];
  /** skill ids already present in the project (any agent) */
  existingSkillNames: Set<string>;
  /** Resolve skills for a tag group */
  getSkillsForTagGroup: (tagGroupId: string) => Promise<ManagedSkillDto[]>;
  importing?: boolean;
  onClose: () => void;
  onImport: (payload: { skillIds: string[]; agentIds: string[] }) => Promise<void>;
}

function sourceBadge(source: string): { label: string; className: string } {
  if (source === 'skillssh') {
    return { label: 'skills.sh', className: 'bg-bg-selected text-text-secondary border-border' };
  }
  if (source === 'git') {
    return { label: 'git', className: 'bg-bg-hover text-text-secondary border-border' };
  }
  return { label: 'library', className: 'bg-bg-hover text-text-secondary border-border' };
}

/**
 * Add skills from Library into project-local agent skill directories.
 * Supports multi-agent targets, tag-group bulk pick, and per-skill pick.
 */
const ImportToProjectDialog: React.FC<ImportToProjectDialogProps> = React.memo(
  ({
    open,
    projectName,
    agents,
    librarySkills,
    tagGroups,
    existingSkillNames,
    getSkillsForTagGroup,
    importing = false,
    onClose,
    onImport,
  }) => {
    const capableAgents = useMemo(() => agents.filter((a) => a.projectCapable), [agents]);

    const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => {
      // Default: first 3 capable agents (matches reference “pre-selected”)
      return new Set(capableAgents.slice(0, 3).map((a) => a.id));
    });
    const [agentsExpanded, setAgentsExpanded] = useState(false);
    const [pickMode, setPickMode] = useState<PickMode>('skills');
    const [query, setQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [tagFilter, setTagFilter] = useState<TagFilterMode>('all');
    const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [resolving, setResolving] = useState(false);

    const visibleAgents = agentsExpanded ? capableAgents : capableAgents.slice(0, 8);
    const hiddenCount = Math.max(0, capableAgents.length - 8);

    const allTags = useMemo(() => {
      const set = new Set<string>();
      for (const s of librarySkills) {
        for (const t of s.tags) {
          if (t.trim()) set.add(t.trim());
        }
      }
      return Array.from(set).sort();
    }, [librarySkills]);

    const importableSkills = useMemo(
      () => librarySkills.filter((s) => !existingSkillNames.has(s.name)),
      [librarySkills, existingSkillNames],
    );

    const filteredSkills = useMemo(() => {
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
      // Skip disabled skills (Library disable now respected in selection)
      list = list.filter((s) => s.enabled);
      return list;
    }, [importableSkills, sourceFilter, tagFilter, query]);

    const filteredGroups = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return tagGroups;
      return tagGroups.filter((g) => g.name.toLowerCase().includes(q));
    }, [tagGroups, query]);

    const toggleAgent = useCallback((id: string) => {
      setSelectedAgents((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const selectAllAgents = useCallback(() => {
      setSelectedAgents(new Set(capableAgents.map((a) => a.id)));
    }, [capableAgents]);

    const clearAllAgents = useCallback(() => {
      setSelectedAgents(new Set());
    }, []);

    const toggleSkill = useCallback((id: string) => {
      setSelectedSkills((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const toggleGroup = useCallback((id: string) => {
      setSelectedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleConfirm = useCallback(async () => {
      if (selectedAgents.size === 0) {
        setError('Select at least one agent');
        return;
      }
      setError(null);
      setResolving(true);
      try {
        let skillIds: string[] = [];
        if (pickMode === 'skills') {
          skillIds = Array.from(selectedSkills);
        } else {
          const lists = await Promise.all(
            Array.from(selectedGroups).map((id) => getSkillsForTagGroup(id)),
          );
          const map = new Map<string, ManagedSkillDto>();
          for (const list of lists) {
            for (const s of list) {
              if (!existingSkillNames.has(s.name)) map.set(s.id, s);
            }
          }
          skillIds = Array.from(map.keys());
        }
        if (skillIds.length === 0) {
          setError(
            pickMode === 'skills'
              ? 'Select at least one skill'
              : 'Selected tag groups have no new skills to import',
          );
          return;
        }
        await onImport({ skillIds, agentIds: Array.from(selectedAgents) });
      } catch (e) {
        setError(String(e));
      } finally {
        setResolving(false);
      }
    }, [
      selectedAgents,
      pickMode,
      selectedSkills,
      selectedGroups,
      getSkillsForTagGroup,
      existingSkillNames,
      onImport,
    ]);

    if (!open) return null;

    const agentCount = selectedAgents.size;
    const busy = importing || resolving;
    const canSubmit =
      agentCount > 0 &&
      (pickMode === 'skills' ? selectedSkills.size > 0 : selectedGroups.size > 0) &&
      !busy;

    const footerLabel = (() => {
      if (agentCount === 0) return 'Select target agents';
      if (pickMode === 'skills' && selectedSkills.size === 0) {
        return `Select skills to add (${agentCount} agent${agentCount === 1 ? '' : 's'})`;
      }
      if (pickMode === 'tag-groups' && selectedGroups.size === 0) {
        return `Select tag groups (${agentCount} agent${agentCount === 1 ? '' : 's'})`;
      }
      if (pickMode === 'skills') {
        return `Add ${selectedSkills.size} skill${selectedSkills.size === 1 ? '' : 's'} → ${agentCount} agent${agentCount === 1 ? '' : 's'}`;
      }
      return `Add from ${selectedGroups.size} group${selectedGroups.size === 1 ? '' : 's'} → ${agentCount} agent${agentCount === 1 ? '' : 's'}`;
    })();

    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        data-testid="import-to-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-to-project-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          className={cn(
            'relative w-full max-w-[520px] max-h-[min(88vh,720px)] flex flex-col',
            'bg-bg-secondary border border-border rounded-xl shadow-xl overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
            <div className="min-w-0 flex-1">
              <h2 id="import-to-project-title" className="text-sm font-semibold text-text-primary">
                Add from Library
              </h2>
              <p className="text-[11px] text-text-muted mt-0.5 truncate">
                Install into agent skill dirs under{' '}
                <span className="text-text-secondary font-medium">{projectName}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Agent targets */}
          <div className="px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] text-text-muted">
                Target <span className="text-text-secondary">agents</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  selectedAgents.size === capableAgents.length
                    ? clearAllAgents()
                    : selectAllAgents()
                }
                className="text-[11px] font-medium text-accent-blue hover:brightness-110"
              >
                {selectedAgents.size === capableAgents.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            {capableAgents.length === 0 ? (
              <p className="text-[11px] text-text-muted">
                No agents with a known project skills path (e.g. .claude/skills).
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {visibleAgents.map((agent) => {
                    const checked = selectedAgents.has(agent.id);
                    const icon = resolveAgentIconSrc(agent.icon);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 h-7 px-2 rounded-full text-[11px] font-medium border transition-colors',
                          checked
                            ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/40'
                            : 'bg-bg-hover/50 text-text-secondary border-border hover:bg-bg-hover',
                        )}
                      >
                        {icon ? <img src={icon} alt="" className="h-3.5 w-3.5 rounded" /> : null}
                        <span className="truncate max-w-[100px]">{agent.name}</span>
                        {checked ? <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> : null}
                      </button>
                    );
                  })}
                </div>
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setAgentsExpanded((v) => !v)}
                    className="mt-2 text-[11px] text-text-muted hover:text-text-secondary"
                  >
                    {agentsExpanded ? 'Show less' : `More agents (${hiddenCount})`}
                  </button>
                ) : null}
              </>
            )}
          </div>

          {/* Mode + search */}
          <div className="px-4 pt-3 shrink-0 space-y-2.5">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-hover/60 border border-border w-fit">
              {(
                [
                  ['skills', 'Skills'],
                  ['tag-groups', 'Tag groups'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPickMode(key)}
                  className={cn(
                    'h-7 px-3 text-[11px] font-medium rounded-md transition-colors',
                    pickMode === key
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={pickMode === 'skills' ? 'Search library…' : 'Search tag groups…'}
                className={cn(
                  'w-full h-9 pl-8 pr-3 text-[var(--font-size)] rounded-lg',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                )}
              />
            </div>
          </div>

          {pickMode === 'skills' ? (
            <>
              <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto thin-scrollbar shrink-0">
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
              <div className="flex items-center gap-1.5 px-4 pb-2 border-b border-border shrink-0">
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
            </>
          ) : (
            <div className="px-4 py-2 border-b border-border shrink-0">
              <p className="text-[11px] text-text-muted leading-relaxed">
                All skills in selected tag groups will be installed into the chosen agents&apos;
                project skill directories.
              </p>
            </div>
          )}

          {/* List */}
          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
            {pickMode === 'skills' ? (
              filteredSkills.length === 0 ? (
                <div className="py-12 px-6 text-center text-text-muted text-sm">
                  {importableSkills.length === 0
                    ? 'All library skills are already in this project, or the library is empty.'
                    : 'No matching skills'}
                </div>
              ) : (
                <ul
                  className="divide-y divide-border/60"
                  role="listbox"
                  aria-multiselectable="true"
                >
                  {filteredSkills.map((skill) => {
                    const checked = selectedSkills.has(skill.id);
                    const badge = sourceBadge(skill.source_type);
                    return (
                      <li key={skill.id}>
                        <div
                          role="option"
                          tabIndex={0}
                          aria-selected={checked}
                          onClick={() => toggleSkill(skill.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleSkill(skill.id);
                            }
                          }}
                          className={cn(
                            'w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors',
                            'hover:bg-bg-hover/60',
                            checked && 'bg-bg-hover/40',
                          )}
                        >
                          <span className="pt-0.5 shrink-0 pointer-events-none">
                            <Checkbox checked={checked} tabIndex={-1} aria-hidden />
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
              )
            ) : filteredGroups.length === 0 ? (
              <div className="py-12 px-6 text-center text-text-muted text-sm">
                {tagGroups.length === 0
                  ? 'No tag groups yet. Create one in the Skills sidebar.'
                  : 'No matching groups'}
              </div>
            ) : (
              <ul>
                {filteredGroups.map((tg) => {
                  const checked = selectedGroups.has(tg.id);
                  return (
                    <li key={tg.id}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(tg.id)}
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
                              : 'border-border',
                          )}
                        >
                          {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
                          {tg.name}
                        </span>
                        <span className="text-[11px] text-text-muted tabular-nums">
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

          <div className="px-4 py-3 border-t border-border shrink-0">
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit}
              onClick={() => void handleConfirm()}
              className="w-full h-10 rounded-lg text-sm font-medium gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {footerLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

ImportToProjectDialog.displayName = 'ImportToProjectDialog';

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

export default ImportToProjectDialog;
