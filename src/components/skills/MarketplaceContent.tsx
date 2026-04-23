import React, { useCallback, useMemo } from "react";
import { Store, Loader2 } from "lucide-react";
import { useSkillContext } from "../../contexts";
import { useMarketplace } from "../../hooks/useMarketplace";
import MarketplaceSearchBar from "./MarketplaceSearchBar";
import LeaderboardToggle from "./LeaderboardToggle";
import MarketSkillCard from "./MarketSkillCard";

const MarketplaceContent: React.FC = React.memo(() => {
  const { skills, refreshSkills } = useSkillContext();

  // Get list of installed skill names
  const installedSkillNames = useMemo(() => 
    skills.map(s => s.name),
    [skills]
  );

  // Use marketplace hook
  const {
    displayList,
    board,
    setBoard,
    searchQuery,
    setSearchQuery,
    loading,
    installingIds,
    installProgress,
    installFromMarket,
    isInstalled,
  } = useMarketplace({
    installedSkills: installedSkillNames,
    onSkillInstalled: refreshSkills,
  });

  const handleInstall = useCallback(
    async (source: string, skillId: string) => {
      try {
        await installFromMarket(source, skillId);
      } catch (e) {
        console.error("Install failed:", e);
      }
    },
    [installFromMarket]
  );

  // Get the full ID for a skill (source/skill_id)
  const getFullId = (source: string, skillId: string) => `${source}/${skillId}`;

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <MarketplaceSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
      />

      {/* Leaderboard toggle (hidden when searching) */}
      {!searchQuery && (
        <LeaderboardToggle
          value={board}
          onChange={setBoard}
          disabled={loading}
        />
      )}

      {/* Search results header */}
      {searchQuery && (
        <div className="px-4 py-2 border-b border-border">
          <span className="text-xs text-text-muted">
            {loading ? "Searching..." : `Results for "${searchQuery}"`}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <Loader2 className="h-8 w-8 animate-spin opacity-50" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <Store className="h-12 w-12 opacity-30" />
            <span className="text-sm">
              {searchQuery ? "No results found" : "No skills available"}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {displayList.map((skill) => {
              const fullId = getFullId(skill.source, skill.skill_id);
              const isSkillInstalled = isInstalled(skill.skill_id);
              const isInstalling = installingIds.has(fullId);
              const phase = installProgress.get(fullId);

              return (
                <MarketSkillCard
                  key={skill.id}
                  skill={skill}
                  isInstalled={isSkillInstalled}
                  isInstalling={isInstalling}
                  installPhase={phase}
                  onInstall={handleInstall}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

MarketplaceContent.displayName = "MarketplaceContent";

export default MarketplaceContent;
