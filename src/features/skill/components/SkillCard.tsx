import React, { useEffect, useState } from 'react';
import {
  Trash2,
  FileText,
  Edit3,
  MoreHorizontal,
  Check,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/ui';
import type { ManagedSkillDto } from '@/shared/types';
import { cn } from '@/lib/utils';
import { getAgentIconSrc } from '@/shared/utils/agents';
import { tagChipClass } from './skillTagColors';
import { getSkillDocument } from '@/features/skill/api/skillApi';
import { parseSkillDescription } from '@/features/skill/utils/parseSkillDescription';

interface SkillCardProps {
  skill: ManagedSkillDto;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: 'detail' | 'delete' | 'edit') => void;
  onAddToTagGroup?: (tagGroupId: string) => void;
  onCheckUpdate?: () => void;
  onUpdateSkill?: () => void;
  tagGroups?: Array<{ id: string; name: string }>;
  installedAgents?: string[];
  presetLabel?: string | null;
  /** Called when description is recovered from SKILL.md so store can update. */
  onDescriptionResolved?: (skillId: string, description: string) => void;
}

const AGENT_STRIP = [
  { key: 'claude-code', label: 'Claude Code', icon: 'claude-code.png' },
  { key: 'codex', label: 'Codex', icon: 'codex.png' },
  { key: 'opencode', label: 'OpenCode', icon: 'opencode.png' },
  { key: 'gemini', label: 'Gemini', icon: 'gemini.png' },
];

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
    installedAgents = [],
    presetLabel,
    onDescriptionResolved,
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

    const showAgents =
      installedAgents.length > 0
        ? AGENT_STRIP.filter(a => installedAgents.includes(a.key))
        : AGENT_STRIP;

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
          'group flex flex-col h-full min-h-[172px] rounded-xl cursor-pointer',
          'bg-bg-primary transition-colors duration-150',
          'border-2',
          enabled ? 'border-accent-green/70' : 'border-border',
          isSelected && 'ring-2 ring-accent-blue/40',
          'hover:bg-bg-hover/40',
        )}
      >
        <div className="flex flex-col flex-1 gap-2 px-3.5 pt-3.5 pb-2 min-h-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0',
                enabled
                  ? 'border-accent-green bg-accent-green/15 text-accent-green'
                  : 'border-text-muted/45 bg-transparent',
              )}
              aria-hidden
            >
              {enabled ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>

            <h3 className="flex-1 min-w-0 text-[13px] font-semibold text-text-primary truncate leading-none">
              {skill.name}
            </h3>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover',
                    'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0',
                  )}
                  title="Actions"
                  onClick={e => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-40"
                onClick={e => e.stopPropagation()}
              >
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
                    className="flex items-center gap-2 cursor-pointer text-xs text-accent-green"
                    onSelect={() => onUpdateSkill()}
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update skill
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer text-xs text-accent-red"
                  onSelect={() => onAction('delete')}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Description — always reserve 2 lines; use secondary color for readability */}
          <p
            className={cn(
              'text-[12px] leading-relaxed line-clamp-2 pl-[26px] min-h-[2.5em]',
              resolvedDesc ? 'text-text-secondary' : 'text-text-muted italic',
            )}
            title={displayDesc}
          >
            {displayDesc}
          </p>

          {hasUpdate && (
            <button
              type="button"
              className="self-start pl-[26px] text-[12px] font-medium text-accent-yellow hover:underline"
              onClick={e => {
                e.stopPropagation();
                onUpdateSkill?.();
              }}
            >
              Update
            </button>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pl-[26px]">
              {chips.map(tag => (
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
          )}
        </div>

        <div className="flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]">
          <div className="flex items-center gap-1 min-w-0 flex-1 text-text-muted">
            <SourceLabel source={skill.source_type} />
            {presetLabel ? (
              <>
                <span className="opacity-40 shrink-0">·</span>
                <span className="truncate font-medium text-orange-400">{presetLabel}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {showAgents.map(agent => {
              const src = getAgentIconSrc(agent.icon);
              if (!src) return null;
              return (
                <img
                  key={agent.key}
                  src={src}
                  alt={agent.label}
                  title={agent.label}
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
