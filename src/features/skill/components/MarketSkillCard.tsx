import React, { useCallback, useMemo } from 'react';
import { Download, Loader2, ExternalLink } from '@/shared/components/icons';
import { Button } from '@/ui';
import type { SkillsShSkill, InstallProgress } from '@/shared/types';
import { cn } from '@/lib/utils';
import { humanizeSkillId } from '@/features/skill/utils/parseSkillDescription';
import { openInDefaultBrowser } from '@/features/browser/api/browserApi';

interface MarketSkillCardProps {
  skill: SkillsShSkill;
  isInstalled: boolean;
  isInstalling: boolean;
  isUninstalling?: boolean;
  installPhase?: InstallProgress['phase'];
  onInstall: (source: string, skillId: string) => void;
  onUninstall?: (skillId: string) => void;
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

/** Compact marketplace card — 4-up grid friendly. */
const MarketSkillCard: React.FC<MarketSkillCardProps> = React.memo(
  ({
    skill,
    isInstalled,
    isInstalling,
    isUninstalling = false,
    installPhase,
    onInstall,
    onUninstall,
  }) => {
    const busy = isInstalling || isUninstalling;

    const handleInstall = useCallback(() => {
      onInstall(skill.source, skill.skill_id);
    }, [skill.source, skill.skill_id, onInstall]);

    const handleUninstall = useCallback(() => {
      onUninstall?.(skill.skill_id);
    }, [skill.skill_id, onUninstall]);

    const avatarUrl = useMemo(() => getAvatarUrl(skill.source), [skill.source]);
    const skillPageUrl = useMemo(
      () => getSkillPageUrl(skill.source, skill.skill_id),
      [skill.source, skill.skill_id],
    );

    const handleOpenExternal = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await openInDefaultBrowser(skillPageUrl);
        } catch (err) {
          console.error('Failed to open skills.sh:', err);
        }
      },
      [skillPageUrl],
    );

    return (
      <div
        className={cn(
          'group flex flex-col h-full min-h-[112px] rounded-lg bg-bg-primary border',
          'transition-colors duration-150 hover:bg-bg-hover/50',
          isInstalled ? 'border-accent-green/60' : 'border-border',
        )}
      >
        <div className="flex items-start gap-2 px-2.5 pt-2.5 pb-1.5 flex-1 min-w-0">
          <img
            src={avatarUrl}
            alt=""
            className="w-6 h-6 rounded-md shrink-0 border border-border bg-bg-hover mt-0.5"
            loading="lazy"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <span className="text-[12px] font-semibold text-text-primary truncate leading-snug flex-1">
                {skill.name || skill.skill_id}
              </span>
              <button
                type="button"
                className="p-0.5 rounded text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title="Open on skills.sh"
                onClick={e => void handleOpenExternal(e)}
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[11px] text-text-secondary truncate leading-snug mt-0.5">
              {humanizeSkillId(skill.skill_id || skill.name)}
            </p>
            <div className="text-[10px] text-text-muted truncate font-mono mt-0.5">
              {skill.source}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 border-t border-border/80">
          {skill.installs > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted tabular-nums">
              <Download className="h-2.5 w-2.5" />
              {formatInstalls(skill.installs)}
            </span>
          ) : (
            <span />
          )}

          {busy ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {isUninstalling
                ? 'Removing…'
                : installPhase
                  ? phaseLabels[installPhase]
                  : '…'}
            </span>
          ) : isInstalled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUninstall}
              className="h-6 px-2 text-[10px] font-semibold text-text-secondary hover:text-accent-red"
            >
              Uninstall
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleInstall}
              className="h-6 px-2 text-[10px] font-semibold text-text-secondary hover:text-accent-blue"
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
