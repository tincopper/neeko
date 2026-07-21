import React, { useEffect, useState } from 'react';
import {
  Trash2,
  Eye,
  Edit3,
  MoreHorizontal,
  HardDrive,
  GitBranch,
  Store,
  ArrowUpCircle,
  Tags,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/ui';
import type { ManagedSkillDto } from '@/shared/types';
import { cn } from '@/lib/utils';
import { getAgentIconSrc } from '@/shared/utils/agents';
import { tagChipClass, presetBadgeClass } from './skillTagColors';
import { getSkillDocument } from '@/features/skill/api/skillApi';
import { parseSkillDescription } from '@/features/skill/utils/parseSkillDescription';
import {
  skillMenuContentClass,
  skillMenuItemClass,
  skillMenuLabelClass,
  skillMenuSeparatorClass,
} from './skillMenuStyles';

interface SkillCardProps {
  skill: ManagedSkillDto;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: 'detail' | 'delete' | 'edit') => void;
  onAddToTagGroup?: (tagGroupId: string) => void;
  onCheckUpdate?: () => void;
  onUpdateSkill?: () => void;
  tagGroups?: Array<{ id: string; name: string }>;
  agents?: Array<{ id: string; icon: string | null; name: string }>;
  presetLabel?: string | null;
  /** Called when description is recovered from SKILL.md so store can update. */
  onDescriptionResolved?: (skillId: string, description: string) => void;
  /** Called when a tag chip is clicked. */
  onTagClick?: (tag: string) => void;
}

function SourceLabel({ source }: { source: string }) {
  if (source === 'skillssh') {
    return (
      <span className="inline-flex items-center gap-1 min-w-0">
        <Store className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate">skills.sh</span>
      </span>
    );
  }
  if (source === 'git') {
    return (
      <span className="inline-flex items-center gap-1 min-w-0">
        <GitBranch className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate">git</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <HardDrive className="h-3 w-3 shrink-0 opacity-70" />
      <span className="truncate">local</span>
    </span>
  );
}

const SkillCard: React.FC<SkillCardProps> = React.memo(
  ({
    skill,
    isSelected,
    onSelect,
    onAction,
    onAddToTagGroup,
    onCheckUpdate,
    onUpdateSkill,
    tagGroups = [],
    agents = [],
    presetLabel,
    onDescriptionResolved,
    onTagClick,
  }) => {
    const isGitSource = skill.source_type === 'git' || skill.source_type === 'skillssh';
    const hasUpdate = skill.update_status === 'update_available';
    const enabled = Boolean(skill.enabled);
    const chips = skill.tags.slice(0, 4);

    const propDesc = skill.description?.trim() || '';
    const [resolvedDesc, setResolvedDesc] = useState(propDesc);

    // Sync when store provides description
    useEffect(() => {
      if (propDesc) setResolvedDesc(propDesc);
    }, [propDesc, skill.id]);

    // Lazy-fill description from SKILL.md when missing
    useEffect(() => {
      if (propDesc) return;
      let cancelled = false;
      void (async () => {
        try {
          const doc = await getSkillDocument(skill.id);
          const parsed = parseSkillDescription(doc.content);
          if (!cancelled && parsed) {
            setResolvedDesc(parsed);
            onDescriptionResolved?.(skill.id, parsed);
          }
        } catch {
          /* no document on disk */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [skill.id, propDesc, onDescriptionResolved]);

    const showAgents = agents;

    const displayDesc = resolvedDesc || 'No description';

    return (
      <article
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'group flex flex-col h-full min-h-[160px] rounded-xl cursor-pointer',
          'bg-bg-primary transition-colors duration-150',
          'border',
          enabled ? 'border-accent-green/60' : 'border-border',
          isSelected && 'ring-1 ring-accent-blue/50',
          'hover:bg-bg-hover/40',
        )}
      >
        <div className="flex flex-col flex-1 gap-2 px-3.5 pt-3.5 pb-2 min-h-0">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 min-w-0 text-[13px] font-semibold text-text-primary truncate leading-none">
              {skill.name}
            </h3>

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
                title="View"
                onClick={e => {
                  e.stopPropagation();
                  onAction('detail');
                }}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
                title="Edit"
                onClick={e => {
                  e.stopPropagation();
                  onAction('edit');
                }}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
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
                  onClick={e => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={6}
                className={skillMenuContentClass('w-[188px]')}
                onClick={e => e.stopPropagation()}
              >
                <DropdownMenuItem
                  className={skillMenuItemClass()}
                  onSelect={() => onAction('edit')}
                >
                  <Edit3 />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={skillMenuItemClass()}
                  onSelect={() => onAction('detail')}
                >
                  <Eye />
                  View
                </DropdownMenuItem>

                {tagGroups.length > 0 && onAddToTagGroup && (
                  <>
                    <DropdownMenuSeparator className={skillMenuSeparatorClass()} />
                    <DropdownMenuLabel className={skillMenuLabelClass()}>
                      <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-medium text-text-muted">
                        <Tags className="h-3 w-3 opacity-70" />
                        Add to preset
                      </span>
                    </DropdownMenuLabel>
                    {tagGroups.map(tg => (
                      <DropdownMenuItem
                        key={tg.id}
                        className={skillMenuItemClass({ className: 'pl-3' })}
                        onSelect={() => onAddToTagGroup(tg.id)}
                      >
                        <span className="truncate">{tg.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}

                {isGitSource && (onCheckUpdate || (hasUpdate && onUpdateSkill)) && (
                  <>
                    <DropdownMenuSeparator className={skillMenuSeparatorClass()} />
                    {onCheckUpdate && (
                      <DropdownMenuItem
                        className={skillMenuItemClass()}
                        onSelect={() => onCheckUpdate()}
                      >
                        Check update
                      </DropdownMenuItem>
                    )}
                    {hasUpdate && onUpdateSkill && (
                      <DropdownMenuItem
                        className={skillMenuItemClass({
                          className: 'text-accent-green data-[highlighted]:text-accent-green',
                        })}
                        onSelect={() => onUpdateSkill()}
                      >
                        <ArrowUpCircle />
                        Update skill
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                <DropdownMenuSeparator className={skillMenuSeparatorClass()} />
                <DropdownMenuItem
                  className={skillMenuItemClass({ danger: true })}
                  onSelect={() => onAction('delete')}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Description — always reserve 2 lines */}
          <p
            className={cn(
              'text-[12px] leading-relaxed line-clamp-2 min-h-[2.5em]',
              resolvedDesc ? 'text-text-secondary' : 'text-text-muted italic',
            )}
            title={displayDesc}
          >
            {displayDesc}
          </p>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map(tag => (
                <span
                  key={tag}
                  role="button"
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation();
                    onTagClick?.(tag);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onTagClick?.(tag);
                    }
                  }}
                  className={cn(
                    'inline-flex items-center text-[11px] leading-none px-2 py-1 rounded-md font-medium cursor-pointer hover:opacity-80 transition-opacity',
                    tagChipClass(tag),
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {presetLabel && (
            <span className={cn('inline-flex self-start text-[11px] leading-none px-2 py-1 rounded-md font-medium', presetBadgeClass(presetLabel))}>
              {presetLabel}
            </span>
          )}

          {hasUpdate && (
            <button
              type="button"
              className="self-start text-[12px] font-medium text-accent-yellow hover:underline"
              onClick={e => {
                e.stopPropagation();
                onUpdateSkill?.();
              }}
            >
              Update
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <div className="flex items-center gap-1 min-w-0 flex-1 text-text-muted">
            <SourceLabel source={skill.source_type} />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {showAgents.map(agent => {
              const src = getAgentIconSrc(agent.icon);
              if (!src) return null;
              return (
                <img
                  key={agent.id}
                  src={src}
                  alt={agent.name}
                  title={agent.name}
                  className={cn(
                    'w-4 h-4 rounded-[3px]',
                    enabled ? 'opacity-100' : 'opacity-30 grayscale',
                  )}
                />
              );
            })}
          </div>

          <span
            className={cn(
              'shrink-0 font-semibold',
              enabled ? 'text-accent-green' : 'text-text-muted',
            )}
          >
            {enabled ? 'Enabled' : 'Enable'}
          </span>
        </div>
      </article>
    );
  },
);

SkillCard.displayName = 'SkillCard';

export default SkillCard;
