import { Eye, HardDrive, Link2, MoreHorizontal, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { getSkillDocument } from '@/features/skill/api/skillApi';
import { parseSkillDescription } from '@/features/skill/utils/parseSkillDescription';
import { cn } from '@/lib/utils';
import type { AgentDiskSkill, ManagedSkillDto } from '@/shared/types';
import { getAgentIconSrc } from '@/shared/utils/agents';
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
import { tagChipClass } from './skillTagColors';

interface AgentSkillCardProps {
  skill: AgentDiskSkill;
  /** Matching library skill when managed (tags / richer metadata). */
  librarySkill?: ManagedSkillDto | null;
  agentIcon?: string | null;
  agentName?: string;
  isSelected?: boolean;
  onSelect?: () => void;
  /** View skill content (library doc or on-disk SKILL.md). */
  onView?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}

/**
 * Agent-disk skill card — layout aligned with Library {@link SkillCard}.
 */
const AgentSkillCard: React.FC<AgentSkillCardProps> = React.memo(
  ({
    skill,
    librarySkill = null,
    agentIcon = null,
    agentName,
    isSelected = false,
    onSelect,
    onView,
    onRemove,
    removing,
  }) => {
    const managed = skill.managed;
    const propDesc = skill.description?.trim() || librarySkill?.description?.trim() || '';
    const [resolvedDesc, setResolvedDesc] = useState(propDesc);
    const chips = (librarySkill?.tags ?? []).slice(0, 4);

    useEffect(() => {
      if (propDesc) setResolvedDesc(propDesc);
    }, [propDesc, skill.path]);

    // Lazy description from library SKILL.md when managed and description missing
    useEffect(() => {
      if (propDesc || !librarySkill?.id) return;
      let cancelled = false;
      void (async () => {
        try {
          const doc = await getSkillDocument(librarySkill.id);
          const parsed = parseSkillDescription(doc.content);
          if (!cancelled && parsed) setResolvedDesc(parsed);
        } catch {
          /* no document */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [librarySkill?.id, propDesc]);

    const displayDesc = resolvedDesc || 'No description';
    const agentIconSrc = getAgentIconSrc(agentIcon);

    const handleSelect = () => {
      onSelect?.();
    };

    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={`agent-skill-card-${skill.name}`}
        onClick={handleSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
        className={cn(
          'group flex flex-col h-full min-h-[160px] rounded-xl cursor-pointer',
          'bg-bg-primary transition-colors duration-150',
          'border',
          managed ? 'border-border' : 'border-border border-dashed',
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
                className={skillMenuContentClass('w-[188px]')}
                onClick={(e) => e.stopPropagation()}
              >
                {onView ? (
                  <DropdownMenuItem className={skillMenuItemClass()} onSelect={() => onView()}>
                    <Eye />
                    View
                  </DropdownMenuItem>
                ) : null}
                {onView && onRemove ? (
                  <DropdownMenuSeparator className={skillMenuSeparatorClass()} />
                ) : null}
                {onRemove ? (
                  <DropdownMenuItem
                    className={skillMenuItemClass({ danger: true })}
                    disabled={removing}
                    onSelect={() => onRemove()}
                  >
                    <Trash2 />
                    Remove from agent
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p
            className={cn(
              'text-[12px] leading-relaxed line-clamp-2 min-h-[2.5em]',
              resolvedDesc ? 'text-text-secondary' : 'text-text-muted italic',
            )}
            title={displayDesc}
          >
            {displayDesc}
          </p>

          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center text-[11px] leading-none px-2 py-1 rounded-md font-medium',
                    tagChipClass(tag),
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <div className="flex items-center gap-1 min-w-0 flex-1 text-text-muted">
            {managed ? (
              <span className="inline-flex items-center gap-1 min-w-0">
                <Link2 className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">library</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 min-w-0">
                <HardDrive className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">local</span>
              </span>
            )}
          </div>

          {agentIconSrc ? (
            <div className="flex items-center gap-1 shrink-0">
              <img
                src={agentIconSrc}
                alt={agentName ?? ''}
                title={agentName}
                className="w-4 h-4 rounded-[3px] opacity-100"
              />
            </div>
          ) : null}

          <span
            className={cn(
              'shrink-0 font-semibold',
              managed ? 'text-accent-blue' : 'text-text-muted',
            )}
          >
            {managed ? 'Synced' : 'Local'}
          </span>
        </div>
      </div>
    );
  },
);

AgentSkillCard.displayName = 'AgentSkillCard';

export default AgentSkillCard;
