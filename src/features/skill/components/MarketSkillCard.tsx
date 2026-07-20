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
 * Marketplace row — dense list item, not a marketing card.
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
          'group flex items-center gap-2.5 pl-3 pr-2 py-2 mx-1.5 rounded-md',
          'hover:bg-bg-hover transition-colors duration-150',
        )}
      >
        <img
          src={avatarUrl}
          alt=""
          className="w-7 h-7 rounded-md shrink-0 border border-border bg-bg-hover"
          loading="lazy"
        />

        <div className="flex-1 min-w-0">
          <div className="text-[var(--font-size)] font-medium text-text-primary truncate">
            {skill.name || skill.skill_id}
          </div>
          <div className="flex items-center gap-2 text-[0.85em] text-text-muted min-w-0">
            <span className="truncate font-mono">{skill.source}</span>
            {skill.installs > 0 && (
              <span className="inline-flex items-center gap-0.5 shrink-0 tabular-nums">
                <Download className="h-2.5 w-2.5" />
                {formatInstalls(skill.installs)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <a
            href={skillPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
            title="Open on skills.sh"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          {isInstalled && !isInstalling ? (
            <span className="inline-flex items-center gap-1 h-6 px-2 text-[10px] text-accent-green rounded-md bg-accent-green/10">
              <Check className="h-3 w-3" />
              Installed
            </span>
          ) : isInstalling ? (
            <span className="inline-flex items-center gap-1 h-6 px-2 text-[10px] text-accent-yellow rounded-md bg-accent-yellow/10">
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
