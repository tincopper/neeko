import React, { useCallback, useMemo } from 'react';
import { Download, Check, Loader2, ExternalLink } from '@/shared/components/icons';
import { Button } from '@/ui';
import type { SkillsShSkill, InstallProgress } from '@/shared/types';
import { cn } from '@/lib/utils';

interface MarketSkillCardProps {
  skill: SkillsShSkill;
  isInstalled: boolean;
  isInstalling: boolean;
  installPhase?: InstallProgress['phase'];
  onInstall: (source: string, skillId: string) => void;
}

const phaseLabels: Record<InstallProgress['phase'], string> = {
  cloning: 'Cloning…',
  installing: 'Installing…',
  done: 'Done',
  error: 'Error',
};

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function getAvatarUrl(source: string): string {
  const owner = source.split('/')[0];
  return `https://github.com/${owner}.png?size=48`;
}

function getSkillPageUrl(source: string, skillId: string): string {
  return `https://skills.sh/${source}/${skillId}`;
}

/**
 * Marketplace card — same grid card language as Library.
 */
const MarketSkillCard: React.FC<MarketSkillCardProps> = React.memo(
  ({ skill, isInstalled, isInstalling, installPhase, onInstall }) => {
    const handleInstall = useCallback(() => {
      onInstall(skill.source, skill.skill_id);
    }, [skill.source, skill.skill_id, onInstall]);

    const avatarUrl = useMemo(() => getAvatarUrl(skill.source), [skill.source]);
    const skillPageUrl = useMemo(
      () => getSkillPageUrl(skill.source, skill.skill_id),
      [skill.source, skill.skill_id],
    );

    return (
      <div
        className={cn(
          'group flex flex-col rounded-lg border border-border bg-bg-primary min-h-[120px]',
          'hover:bg-bg-hover/40 transition-colors duration-150',
          isInstalled && 'border-l-[3px] border-l-accent',
        )}
      >
        <div className="flex items-start gap-2.5 px-3 pt-3 pb-1">
          <img
            src={avatarUrl}
            alt=""
            className="w-7 h-7 rounded-md shrink-0 border border-border bg-bg-hover"
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-text-primary text-[13px] truncate">
              {skill.name || skill.skill_id}
            </div>
            <div className="text-[11px] text-text-muted truncate font-mono mt-0.5">
              {skill.source}
            </div>
          </div>
          <a
            href={skillPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
            title="Open on skills.sh"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 px-3 py-2.5 border-t border-border/80">
          {skill.installs > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-text-muted tabular-nums">
              <Download className="h-3 w-3" />
              {formatInstalls(skill.installs)}
            </span>
          ) : (
            <span />
          )}

          {isInstalled && !isInstalling ? (
            <span className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium text-accent rounded-md bg-accent/10">
              <Check className="h-3 w-3" />
              Installed
            </span>
          ) : isInstalling ? (
            <span className="inline-flex items-center gap-1 h-6 px-2 text-[10px] text-amber-400 rounded-md bg-amber-400/10">
              <Loader2 className="h-3 w-3 animate-spin" />
              {installPhase ? phaseLabels[installPhase] : '…'}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleInstall}
              className="h-6 px-2.5 text-[11px] text-text-secondary hover:text-accent"
            >
              Install
            </Button>
          )}
        </div>
      </div>
    );
  },
);

MarketSkillCard.displayName = 'MarketSkillCard';

export default MarketSkillCard;
