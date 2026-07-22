import { Eye, LayoutGrid, MoreHorizontal, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import React, { useMemo } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- custom agent icons
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { cn } from '@/lib/utils';
import type { ProjectDiskSkill } from '@/shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui';

import {
  skillMenuContentClass,
  skillMenuItemClass,
  skillMenuSeparatorClass,
} from './skillMenuStyles';

interface AgentChip {
  id: string;
  name: string;
  icon: string | null;
  /** Whether this agent can host project-local skills */
  projectCapable?: boolean;
}

interface TagGroupChip {
  id: string;
  name: string;
}

interface ProjectSkillCardProps {
  skill: ProjectDiskSkill;
  /** All agents available for display / management (prefer project-capable). */
  agents?: AgentChip[];
  /** Bound tag groups this skill belongs to (for display). */
  tagGroups?: TagGroupChip[];
  /** Project target agent id (`selected_agent`) — highlighted when present. */
  targetAgentId?: string | null;
  isSelected?: boolean;
  onSelect?: () => void;
  onView?: () => void;
  onRemove?: () => void;
  /**
   * Toggle / install skill for one agent.
   * - existing agent: enable/disable
   * - not yet linked + managed skill: enable = install to that agent
   */
  onToggleAgent?: (agentId: string, enabled: boolean) => void;
  /** Toggle skill for all associated agents */
  onToggleEnabled?: (enabled: boolean) => void;
  toggling?: boolean;
  removing?: boolean;
}

const MAX_AGENT_ICONS = 8;
const MAX_TAG_CHIPS = 3;

/**
 * Project-local skill card with tag-group badges, target agent highlight,
 * and per-agent enable / add management.
 */
const ProjectSkillCard: React.FC<ProjectSkillCardProps> = React.memo(
  ({
    skill,
    agents = [],
    tagGroups = [],
    targetAgentId = null,
    isSelected = false,
    onSelect,
    onView,
    onRemove,
    onToggleAgent,
    onToggleEnabled,
    toggling,
    removing,
  }) => {
    const agentMeta = new Map(agents.map((a) => [a.id, a]));
    const states = useMemo(() => skill.agents ?? [], [skill.agents]);
    const linkedIds = useMemo(() => new Set(states.map((s) => s.agent_id)), [states]);
    const enabled = skill.enabled;
    const inLibrary = skill.managed;
    const displayDesc = skill.description?.trim() || 'No description';

    // Linked agents first, then other project-capable agents that can still be added.
    const agentRows = useMemo(() => {
      const linked = states.map((st) => ({
        agent_id: st.agent_id,
        enabled: st.enabled,
        linked: true as const,
      }));
      const canAdd = Boolean(onToggleAgent && skill.skill_id);
      if (!canAdd) return linked;

      const extras = agents
        .filter((a) => a.projectCapable !== false && !linkedIds.has(a.id))
        .map((a) => ({
          agent_id: a.id,
          enabled: false,
          linked: false as const,
        }));
      return [...linked, ...extras];
    }, [agents, linkedIds, onToggleAgent, skill.skill_id, states]);

    const visible = agentRows.slice(0, MAX_AGENT_ICONS);
    const overflow = Math.max(0, agentRows.length - MAX_AGENT_ICONS);
    const shownTags = tagGroups.slice(0, MAX_TAG_CHIPS);
    const tagOverflow = Math.max(0, tagGroups.length - MAX_TAG_CHIPS);

    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={`project-skill-card-${skill.name}`}
        onClick={() => onSelect?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        className={cn(
          'group flex flex-col h-full min-h-[132px] rounded-lg cursor-pointer',
          'bg-bg-primary transition-colors duration-150 border border-border',
          !enabled && 'opacity-90',
          isSelected && 'ring-1 ring-accent-blue/50 border-accent-blue/40',
          'hover:bg-bg-hover/40',
        )}
      >
        <div className="flex flex-col flex-1 gap-2 px-3.5 pt-3.5 pb-2 min-h-0">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 min-w-0 text-[13px] font-semibold text-text-primary truncate leading-none">
              {skill.name}
            </h3>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {onView ? (
                <button
                  type="button"
                  className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
                  title="View"
                  onClick={(e) => {
                    e.stopPropagation();
                    onView();
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover',
                    'opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
                    'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary',
                    'transition-opacity shrink-0',
                  )}
                  title="Actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={6}
                className={skillMenuContentClass('w-[200px]')}
                onClick={(e) => e.stopPropagation()}
              >
                {onView ? (
                  <DropdownMenuItem className={skillMenuItemClass()} onSelect={() => onView()}>
                    <Eye />
                    View
                  </DropdownMenuItem>
                ) : null}
                {onToggleEnabled ? (
                  <DropdownMenuItem
                    className={skillMenuItemClass()}
                    disabled={toggling}
                    onSelect={() => onToggleEnabled(!enabled)}
                  >
                    {enabled ? <PowerOff /> : <Power />}
                    {enabled ? 'Disable for all agents' : 'Enable for all agents'}
                  </DropdownMenuItem>
                ) : null}
                {(onView || onToggleEnabled) && onRemove ? (
                  <DropdownMenuSeparator className={skillMenuSeparatorClass()} />
                ) : null}
                {onRemove ? (
                  <DropdownMenuItem
                    className={skillMenuItemClass({ danger: true })}
                    disabled={removing}
                    onSelect={() => onRemove()}
                  >
                    <Trash2 />
                    Remove from project
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p
            className={cn(
              'text-[12px] leading-relaxed line-clamp-2 min-h-[2.5em]',
              skill.description ? 'text-text-secondary' : 'text-text-muted italic',
            )}
            title={displayDesc}
          >
            {displayDesc}
          </p>

          {shownTags.length > 0 ? (
            <div className="flex flex-wrap gap-1" data-testid={`project-skill-tags-${skill.name}`}>
              {shownTags.map((tg) => (
                <span
                  key={tg.id}
                  className={cn(
                    'inline-flex items-center gap-1 h-5 max-w-[8rem] px-1.5 rounded-md',
                    'text-[10px] font-medium border border-border bg-bg-hover/60 text-text-secondary',
                  )}
                  title={tg.name}
                >
                  <LayoutGrid className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
                  <span className="truncate">{tg.name}</span>
                </span>
              ))}
              {tagOverflow > 0 ? (
                <span className="text-[10px] text-text-muted tabular-nums self-center">
                  +{tagOverflow}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium bg-bg-selected text-text-secondary border border-border shrink-0">
            {inLibrary ? 'In library' : 'Local'}
          </span>

          <div
            className="flex items-center gap-1 min-w-0 flex-1 justify-end"
            data-testid={`project-skill-agents-${skill.name}`}
          >
            {visible.map((st) => {
              const meta = agentMeta.get(st.agent_id);
              const src = resolveAgentIconSrc(meta?.icon ?? null);
              const label = meta?.name ?? st.agent_id;
              const isTarget = targetAgentId != null && st.agent_id === targetAgentId;
              const isLinked = st.linked;
              const canToggle = Boolean(
                onToggleAgent && (isLinked ? st.enabled || skill.skill_id : skill.skill_id),
              );
              return (
                <button
                  key={st.agent_id}
                  type="button"
                  disabled={toggling || !canToggle}
                  data-testid={`project-skill-agent-${skill.name}-${st.agent_id}`}
                  data-linked={isLinked ? 'true' : 'false'}
                  data-target={isTarget ? 'true' : 'false'}
                  title={
                    !isLinked
                      ? `Add to ${label}`
                      : canToggle
                        ? st.enabled
                          ? `Disable for ${label}${isTarget ? ' (target)' : ''}`
                          : `Enable for ${label}${isTarget ? ' (target)' : ''}`
                        : label
                  }
                  aria-label={
                    !isLinked
                      ? `Add ${skill.name} for ${label}`
                      : st.enabled
                        ? `Disable ${skill.name} for ${label}`
                        : `Enable ${skill.name} for ${label}`
                  }
                  aria-pressed={isLinked ? st.enabled : false}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canToggle) return;
                    if (!isLinked) onToggleAgent?.(st.agent_id, true);
                    else onToggleAgent?.(st.agent_id, !st.enabled);
                  }}
                  className={cn(
                    'relative p-0.5 rounded-[4px] transition-all',
                    canToggle &&
                      'hover:bg-bg-hover hover:ring-1 hover:ring-accent-blue/50 hover:scale-110 cursor-pointer',
                    isLinked && !st.enabled && 'opacity-35 grayscale',
                    !isLinked && 'opacity-70 border border-dashed border-border',
                    isTarget && 'ring-1 ring-accent-blue/60',
                    (toggling || !canToggle) && 'cursor-default',
                  )}
                >
                  {src ? (
                    <img src={src} alt="" className="w-4 h-4 rounded-[3px]" />
                  ) : (
                    <span className="inline-flex w-4 h-4 items-center justify-center rounded-[3px] bg-bg-hover text-[9px] font-semibold text-text-muted">
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {!isLinked ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-bg-secondary border border-border">
                      <Plus className="h-2 w-2 text-text-muted" aria-hidden />
                    </span>
                  ) : null}
                </button>
              );
            })}
            {overflow > 0 ? (
              <span className="text-[10px] text-text-muted tabular-nums pl-0.5">+{overflow}</span>
            ) : null}
          </div>

          <button
            type="button"
            disabled={toggling || !onToggleEnabled}
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnabled?.(!enabled);
            }}
            title={enabled ? 'Disable for all agents' : 'Enable for all agents'}
            className={cn(
              'shrink-0 inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold border transition-colors',
              enabled
                ? 'text-accent-blue border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20 hover:border-accent-blue/50'
                : 'text-text-muted border-border bg-bg-hover hover:bg-bg-selected hover:text-text-secondary',
              onToggleEnabled && !toggling && 'cursor-pointer',
              (!onToggleEnabled || toggling) && 'cursor-default opacity-80',
            )}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </button>

          {onRemove ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              disabled={removing}
              title="Remove from project"
              aria-label={`Remove ${skill.name}`}
              className={cn(
                'p-1 rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10',
                'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
                'disabled:opacity-40 disabled:cursor-not-allowed shrink-0',
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  },
);

ProjectSkillCard.displayName = 'ProjectSkillCard';

export default ProjectSkillCard;
