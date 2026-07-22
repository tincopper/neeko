import { Eye, MoreHorizontal, Power, PowerOff, Trash2 } from 'lucide-react';
import React from 'react';

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
}

interface ProjectSkillCardProps {
  skill: ProjectDiskSkill;
  agents?: AgentChip[];
  isSelected?: boolean;
  onSelect?: () => void;
  onView?: () => void;
  onRemove?: () => void;
  /** Toggle skill for one agent */
  onToggleAgent?: (agentId: string, enabled: boolean) => void;
  /** Toggle skill for all associated agents */
  onToggleEnabled?: (enabled: boolean) => void;
  toggling?: boolean;
  removing?: boolean;
}

const MAX_AGENT_ICONS = 6;

/**
 * Project-local skill card with enable/pause and per-agent toggle.
 */
const ProjectSkillCard: React.FC<ProjectSkillCardProps> = React.memo(
  ({
    skill,
    agents = [],
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
    const states = skill.agents ?? [];
    const visible = states.slice(0, MAX_AGENT_ICONS);
    const overflow = Math.max(0, states.length - MAX_AGENT_ICONS);
    const displayDesc = skill.description?.trim() || 'No description';
    const inLibrary = skill.managed;
    const enabled = skill.enabled;

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
          'group flex flex-col h-full min-h-[132px] rounded-xl cursor-pointer',
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
        </div>

        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium bg-bg-selected text-text-secondary border border-border shrink-0">
            {inLibrary ? 'In library' : 'Local'}
          </span>

          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
            {visible.map((st) => {
              const meta = agentMeta.get(st.agent_id);
              const src = resolveAgentIconSrc(meta?.icon ?? null);
              const label = meta?.name ?? st.agent_id;
              const canToggle = Boolean(onToggleAgent && (st.enabled || skill.skill_id));
              return (
                <button
                  key={st.agent_id}
                  type="button"
                  disabled={toggling || !canToggle}
                  title={
                    canToggle
                      ? st.enabled
                        ? `Disable for ${label}`
                        : `Enable for ${label}`
                      : label
                  }
                  aria-label={
                    st.enabled
                      ? `Disable ${skill.name} for ${label}`
                      : `Enable ${skill.name} for ${label}`
                  }
                  aria-pressed={st.enabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canToggle) onToggleAgent?.(st.agent_id, !st.enabled);
                  }}
                  className={cn(
                    'relative p-0.5 rounded-[4px] transition-all',
                    canToggle &&
                      'hover:bg-bg-hover hover:ring-1 hover:ring-accent-blue/50 hover:scale-110 cursor-pointer',
                    !st.enabled && 'opacity-35 grayscale',
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
