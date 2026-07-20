import React from 'react';
import {
  Trash2,
  FileText,
  Edit3,
  MoreHorizontal,
  Sparkles,
  HardDrive,
  GitBranch,
  Store,
  ArrowUpCircle,
} from 'lucide-react';
import { Tags } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/ui';
import type { ManagedSkillDto } from '@/shared/types';
import { cn } from '@/lib/utils';

interface SkillCardProps {
  skill: ManagedSkillDto;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: 'detail' | 'delete' | 'edit') => void;
  onAddToTagGroup?: (tagGroupId: string) => void;
  onCheckUpdate?: () => void;
  onUpdateSkill?: () => void;
  tagGroups?: Array<{ id: string; name: string }>;
  /** @deprecated unused — kept for call-site compat */
  installedAgents?: string[];
}

function SourceIcon({ source }: { source: string }) {
  const cls = 'h-3 w-3 shrink-0';
  if (source === 'skillssh') return <Store className={cls} />;
  if (source === 'git') return <GitBranch className={cls} />;
  return <HardDrive className={cls} />;
}

function sourceLabel(source: string): string {
  if (source === 'skillssh') return 'Market';
  if (source === 'git') return 'Git';
  if (source === 'local') return 'Local';
  return source;
}

/**
 * Dense skill row — matches SessionRow / ConversationItem density (IDE sidebar style).
 */
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
  }) => {
    const isGitSource = skill.source_type === 'git' || skill.source_type === 'skillssh';
    const hasUpdate = skill.update_status === 'update_available';

    return (
      <div
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
          'group flex items-center gap-2.5 pl-3 pr-2 py-2 mx-1.5 rounded-md cursor-pointer transition-colors duration-150',
          isSelected
            ? 'bg-accent/12 text-text-primary ring-1 ring-inset ring-accent/30'
            : 'hover:bg-bg-hover text-text-primary',
        )}
      >
        {/* Leading icon tile */}
        <span
          className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
            isSelected ? 'bg-accent/20 text-accent' : 'bg-bg-hover text-text-muted',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>

        {/* Title + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[var(--font-size)] font-medium truncate">{skill.name}</span>
            {hasUpdate && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-accent shrink-0"
                title="Update available"
              >
                <ArrowUpCircle className="h-3 w-3" />
              </span>
            )}
            {!skill.enabled && (
              <span className="text-[10px] text-text-muted shrink-0">off</span>
            )}
          </div>
          {skill.description ? (
            <p className="text-[0.85em] text-text-muted truncate leading-snug">
              {skill.description}
            </p>
          ) : null}
        </div>

        {/* Meta + actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              'hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
              'bg-bg-hover text-text-muted',
            )}
            title={skill.source_ref ?? skill.source_type}
          >
            <SourceIcon source={skill.source_type} />
            {sourceLabel(skill.source_type)}
          </span>

          {skill.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted max-w-[72px] truncate"
            >
              {tag}
            </span>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-colors',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100',
                  isSelected && 'opacity-100',
                )}
                title="Actions"
                onClick={e => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40" onClick={e => e.stopPropagation()}>
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-xs"
                onSelect={() => onAction('edit')}
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-xs"
                onSelect={() => onAction('detail')}
              >
                <FileText className="h-3 w-3" />
                View
              </DropdownMenuItem>
              {tagGroups.length > 0 && onAddToTagGroup && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2 cursor-pointer text-xs">
                    <Tags className="h-3 w-3" />
                    Add to group
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-36">
                    {tagGroups.map(tg => (
                      <DropdownMenuItem
                        key={tg.id}
                        className="cursor-pointer text-xs"
                        onSelect={() => onAddToTagGroup(tg.id)}
                      >
                        {tg.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {isGitSource && onCheckUpdate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-center gap-2 cursor-pointer text-xs"
                    onSelect={() => onCheckUpdate()}
                  >
                    Check update
                  </DropdownMenuItem>
                </>
              )}
              {isGitSource && hasUpdate && onUpdateSkill && (
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer text-xs text-accent"
                  onSelect={() => onUpdateSkill()}
                >
                  <ArrowUpCircle className="h-3 w-3" />
                  Update skill
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-xs text-red-400"
                onSelect={() => onAction('delete')}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  },
);

SkillCard.displayName = 'SkillCard';

export default SkillCard;
