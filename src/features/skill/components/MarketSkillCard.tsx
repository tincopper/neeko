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
          'group flex flex-col h-full min-h-[140px] rounded-xl bg-bg-primary border-2',
          'transition-colors duration-150 hover:bg-bg-hover/40',
          isInstalled ? 'border-accent-green/70' : 'border-border',
        )}
      >
        <div className="flex items-start gap-2.5 px-3.5 pt-3.5 pb-2 flex-1">
          <span
            className={cn(
              'mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0',
              isInstalled
                ? 'border-accent-green bg-accent-green/15 text-accent-green'
                : 'border-text-muted/45',
            )}
          >
            {isInstalled ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
          </span>

          <img
            src={avatarUrl}
            alt=""
            className="w-7 h-7 rounded-md shrink-0 border border-border bg-bg-hover"
            loading="lazy"
          />

          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-text-primary truncate leading-snug">
              {skill.name || skill.skill_id}
            </div>
            <div className="text-[12px] text-text-muted truncate font-mono mt-0.5">
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

        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-border">
          {skill.installs > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums">
              <Download className="h-3 w-3" />
              {formatInstalls(skill.installs)}
            </span>
          ) : (
            <span />
          )}

          {isInstalled && !isInstalling ? (
            <span className="text-[11px] font-semibold text-accent-green">Installed</span>
          ) : isInstalling ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-accent-yellow">
              <Loader2 className="h-3 w-3 animate-spin" />
              {installPhase ? phaseLabels[installPhase] : '…'}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleInstall}
              className="h-6 px-2.5 text-[11px] font-semibold text-text-secondary hover:text-accent-green"
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
