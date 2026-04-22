import React, { useCallback } from "react";
import { Download, Check, Loader2 } from "lucide-react";
import { Button } from "../ui";
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

const MarketSkillCard: React.FC<MarketSkillCardProps> = React.memo(
  ({ skill, isInstalled, isInstalling, installPhase, onInstall }) => {
    const handleInstall = useCallback(() => {
      onInstall(skill.source, skill.skill_id);
    }, [skill.source, skill.skill_id, onInstall]);

    const formatInstalls = (count: number): string => {
      if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
      }
      if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}K`;
      }
      return count.toString();
    };

    return (
      <div className="flex items-center justify-between p-3 rounded-lg bg-bg-primary border border-border hover:border-border/80 transition-colors">
        <div className="flex flex-col min-w-0 flex-1 mr-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {skill.name || skill.skill_id}
            </span>
            {skill.installs > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-text-muted shrink-0">
                <Download className="h-3 w-3" />
                {formatInstalls(skill.installs)}
              </span>
            )}
          </div>
          <span className="text-[11px] text-text-muted truncate mt-0.5">
            {skill.source}
          </span>
        </div>

        <div className="shrink-0">
          {isInstalled && !isInstalling ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-500 rounded-md bg-green-500/10">
              <Check className="h-3.5 w-3.5" />
              Installed
            </div>
          ) : isInstalling ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent rounded-md bg-accent/10">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {installPhase ? phaseLabels[installPhase] : "Installing..."}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleInstall}
              className="h-7 px-3 text-xs"
            >
              Install
            </Button>
          )}
        </div>
      </div>
    );
  }
);

MarketSkillCard.displayName = "MarketSkillCard";

export default MarketSkillCard;
