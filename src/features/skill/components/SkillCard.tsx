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
  /** Optional agent keys currently synced / highlighted on the card. */
  installedAgents?: string[];
  /** Preset / tag-group name when filtering. */
  presetLabel?: string | null;
}

const AGENT_LIST = [
  { key: 'claude-code', label: 'Claude Code', icon: 'claude-code.png' },
  { key: 'codex', label: 'Codex', icon: 'codex.png' },
  { key: 'opencode', label: 'OpenCode', icon: 'opencode.png' },
  { key: 'gemini', label: 'Gemini', icon: 'gemini.png' },
  { key: 'qoder', label: 'Qoder', icon: 'qoder.svg' },
  { key: 'codebuddy', label: 'Codebuddy', icon: 'codebuddy.svg' },
];

function SourceMeta({ source }: { source: string }) {
  if (source === 'skillssh') {
    return (
      <>
        <Store className="h-3 w-3 shrink-0 opacity-70" />
        <span>skills.sh</span>
      </>
    );
  }
  if (source === 'git') {
    return (
      <>
        <GitBranch className="h-3 w-3 shrink-0 opacity-70" />
        <span>git</span>
      </>
    );
  }
  return (
    <>
      <HardDrive className="h-3 w-3 shrink-0 opacity-70" />
      <span>local</span>
    </>
  );
}

/**
 * Library skill card — layout inspired by Skills Manager reference,
 * colors use Neeko theme tokens only.
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
    const chips = skill.tags.slice(0, 4);

    const agentKeys =
      installedAgents.length > 0
        ? installedAgents
        : skill.enabled
          ? AGENT_LIST.map(a => a.key)
          : [];

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
          'group flex flex-col rounded-lg border bg-bg-primary cursor-pointer',
          'transition-colors duration-150 hover:bg-bg-hover/40',
          'min-h-[148px]',
          skill.enabled
            ? 'border-l-[3px] border-l-accent border-border'
            : 'border-border',
          isSelected && 'ring-1 ring-accent/50 border-accent/40',
        )}
      >
        {/* Header: check + name + menu */}
        <div className="flex items-start gap-2 px-3 pt-3 pb-1">
          <span
            className={cn(
              'mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
              skill.enabled
                ? 'border-accent bg-accent/20 text-accent'
                : 'border-border text-transparent',
            )}
            aria-hidden
          >
            {skill.enabled && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium text-text-primary text-[13px] truncate">
                {skill.name}
              </span>
              {hasUpdate && (
                <span className="text-[10px] font-medium text-amber-400 shrink-0">Update</span>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06]',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
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

        {/* Description + tags */}
        <div className="px-3 pb-2 flex-1 flex flex-col gap-2 min-h-0">
          <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed min-h-[2.5em]">
            {skill.description || 'No description'}
          </p>
          {(chips.length > 0 || hasUpdate) && (
            <div className="flex flex-wrap gap-1">
              {chips.map(tag => (
                <span
                  key={tag}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full border',
                    tagChipClass(tag),
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center gap-2 px-3 py-2 border-t border-border/80 text-[10px] text-text-muted">
          <span className="inline-flex items-center gap-1 min-w-0 truncate">
            <SourceMeta source={skill.source_type} />
            {presetLabel && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-accent truncate">{presetLabel}</span>
              </>
            )}
          </span>

          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            {agentKeys.slice(0, 5).map(key => {
              const agent = AGENT_LIST.find(a => a.key === key);
              if (!agent) return null;
              const src = getAgentIconSrc(agent.icon);
              return src ? (
                <img
                  key={key}
                  src={src}
                  alt={agent.label}
                  title={agent.label}
                  className={cn(
                    'w-3.5 h-3.5 rounded-sm',
                    skill.enabled ? 'opacity-90' : 'opacity-35',
                  )}
                />
              ) : null;
            })}
          </div>

          <span
            className={cn(
              'shrink-0 font-medium',
              skill.enabled ? 'text-accent' : 'text-text-muted',
            )}
          >
            {skill.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>
    );
  },
);

SkillCard.displayName = 'SkillCard';

export default SkillCard;
