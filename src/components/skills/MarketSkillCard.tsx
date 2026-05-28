import React, { useCallback, useMemo } from "react";
import { Download, Check, Loader2, ExternalLink } from "@/components/icons"
import { Card, CardContent, CardFooter, Button } from "../ui";
import type { SkillsShSkill, InstallProgress } from "../../types";

interface MarketSkillCardProps {
  skill: SkillsShSkill;
  isInstalled: boolean;
  isInstalling: boolean;
  installPhase?: InstallProgress["phase"];
  onInstall: (source: string, skillId: string) => void;
}

const phaseLabels: Record<InstallProgress["phase"], string> = {
  cloning: "Cloning...",
  installing: "Installing...",
  done: "Installed!",
  error: "Error",
};

function formatInstalls(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function getAvatarUrl(source: string): string {
  const owner = source.split("/")[0];
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
      [skill.source, skill.skill_id]
    );

    return (
      <Card variant="hoverable" className="flex flex-col">
        <div className="flex items-start justify-between p-3 pb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img
              src={avatarUrl}
              alt={skill.source.split("/")[0]}
              className="w-5 h-5 rounded-md shrink-0 border border-border"
              loading="lazy"
            />
            <span className="font-medium text-text-primary text-sm truncate">
              {skill.name || skill.skill_id}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <a
              href={skillPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-text-muted hover:text-accent-blue rounded transition-colors"
              title="View on skills.sh"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {isInstalled && !isInstalling ? (
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent-green rounded-md bg-accent-green/10">
                <Check className="h-3 w-3" />
                Installed
              </div>
            ) : isInstalling ? (
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent-yellow rounded-md bg-accent-yellow/10">
                <Loader2 className="h-3 w-3 animate-spin" />
                {installPhase ? phaseLabels[installPhase] : "..."}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleInstall}
                className="h-6 px-2 text-[10px]"
              >
                Install
              </Button>
            )}
          </div>
        </div>

        <CardContent className="p-3 pt-0">
          <span className="text-[11px] text-text-muted truncate block">
            {skill.source}
          </span>
        </CardContent>

        {skill.installs > 0 && (
          <CardFooter className="p-3 pt-0 items-center">
            <span className="flex items-center gap-1 text-[10px] text-text-muted">
              <Download className="h-3 w-3" />
              {formatInstalls(skill.installs)}
            </span>
          </CardFooter>
        )}
      </Card>
    );
  }
);

MarketSkillCard.displayName = "MarketSkillCard";

export default MarketSkillCard;
