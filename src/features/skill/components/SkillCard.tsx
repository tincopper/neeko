import React from 'react';
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

interface SkillCardProps {
  skill: ManagedSkillDto;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: 'detail' | 'delete' | 'edit') => void;
  onAddToTagGroup?: (tagGroupId: string) => void;
  onCheckUpdate?: () => void;
  onUpdateSkill?: () => void;
  tagGroups?: Array<{ id: string; name: string }>;
  /** Agent keys highlighted on the card (synced). Empty = show defaults by enabled state. */
  installedAgents?: string[];
  /** Preset / tag-group name shown in footer (orange in reference). */
  presetLabel?: string | null;
}

/** Agent strip — matches reference footer icon cluster order. */
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

/**
 * Skill library card — layout aligned with Skills Manager reference.
 * Colors use Neeko theme tokens (accent-green for enabled, not light SaaS pastels as base).
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
    installedAgents = [],
    presetLabel,
  }) => {
    const isGitSource = skill.source_type === 'git' || skill.source_type === 'skillssh';
    const hasUpdate = skill.update_status === 'update_available';
    const enabled = skill.enabled;
    const chips = skill.tags.slice(0, 4);

    const showAgents =
      installedAgents.length > 0
        ? AGENT_STRIP.filter(a => installedAgents.includes(a.key))
        : AGENT_STRIP;

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
          'group relative flex flex-col rounded-xl bg-bg-primary cursor-pointer',
          'transition-[border-color,box-shadow,background-color] duration-150',
          'min-h-[168px] border',
          // Full border: green when enabled (reference), neutral when not
          enabled
            ? 'border-[var(--accent-green)]/55 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-green)_12%,transparent)]'
            : 'border-border hover:border-border',
          isSelected && 'ring-2 ring-accent/35',
          'hover:bg-bg-hover/30',
        )}
      >
        {/* ── Body ── */}
        <div className="flex flex-col flex-1 gap-1.5 px-3.5 pt-3.5 pb-2.5 min-h-0">
          {/* Title row: check + name + menu */}
          <div className="flex items-start gap-2">
            <span
              className={cn(
                'mt-0.5 w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center shrink-0',
                enabled
                  ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
                  : 'border-text-muted/50 bg-transparent',
              )}
              aria-hidden
            >
              {enabled ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
            </span>

            <div className="min-w-0 flex-1 pt-px">
              <h3 className="text-[13px] font-semibold text-text-primary leading-snug truncate">
                {skill.name}
              </h3>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'p-1 -mr-1 -mt-0.5 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06]',
                    'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
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
                    className="flex items-center gap-2 cursor-pointer text-xs text-[var(--accent-green)]"
                    onSelect={() => onUpdateSkill()}
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update skill
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer text-xs text-[var(--accent-red)]"
                  onSelect={() => onAction('delete')}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Description — 2 lines, muted */}
          <p className="text-[12px] text-text-muted leading-[1.45] line-clamp-2 pl-[26px]">
            {skill.description?.trim() || 'No description'}
          </p>

          {/* Update link — below description (reference placement) */}
          {hasUpdate && (
            <button
              type="button"
              className="self-start pl-[26px] text-[12px] font-medium text-[var(--accent-yellow)] hover:underline"
              onClick={e => {
                e.stopPropagation();
                onUpdateSkill?.();
              }}
            >
              Update
            </button>
          )}

          {/* Tag pills */}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pl-[26px] pt-0.5">
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

        {/* ── Footer ── reference: source · Preset | agents | Enabled */}
        <div
          className={cn(
            'flex items-center gap-2 px-3.5 py-2.5 mt-auto',
            'border-t border-border/70',
            'text-[11px]',
          )}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1 text-text-muted">
            <SourceLabel source={skill.source_type} />
            {presetLabel ? (
              <>
                <span className="text-text-muted/40 shrink-0">·</span>
                <span className="truncate font-medium text-orange-400/95">{presetLabel}</span>
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
              'shrink-0 font-semibold tabular-nums',
              enabled ? 'text-[var(--accent-green)]' : 'text-text-muted',
            )}
          >
            {enabled ? 'Enabled' : 'Enable'}
          </span>
        </div>
      </div>
    );
  },
);

SkillCard.displayName = 'SkillCard';

export default SkillCard;
