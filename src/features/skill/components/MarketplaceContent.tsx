import React, { useCallback, useMemo } from 'react';
import { Store, Loader2 } from '@/shared/components/icons';
import { useSkillStore } from '@/features/skill/store';
import { useMarketplace } from '@/features/skill/hooks/useMarketplace';
import MarketplaceSearchBar from './MarketplaceSearchBar';
import LeaderboardToggle from './LeaderboardToggle';
import SourceFilter from './SourceFilter';
import Pagination from './Pagination';
import MarketSkillCard from './MarketSkillCard';

interface MarketplaceContentProps {
  /** After marketplace install — open assign-to-tag-group flow. */
  onSkillInstalled?: (skillId: string, skillName: string) => void;
}

const MarketplaceContent: React.FC<MarketplaceContentProps> = React.memo(
  ({ onSkillInstalled }) => {
    const skills = useSkillStore(s => s.skills);
    const refreshSkills = useSkillStore(s => s.refreshSkills);

    const installedSkillNames = useMemo(() => skills.map(s => s.name), [skills]);

    const handleInstalled = useCallback(
      (info: { id: string; name: string }) => {
        void refreshSkills();
        onSkillInstalled?.(info.id, info.name);
      },
      [refreshSkills, onSkillInstalled],
    );

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
      availableSources,
      sourceFilter,
      setSourceFilter,
      page,
      setPage,
      perPage,
      setPerPage,
      totalItems,
      totalPages,
    } = useMarketplace({
      installedSkills: installedSkillNames,
      onSkillInstalled: handleInstalled,
    });

    const handleInstall = useCallback(
      async (source: string, skillId: string) => {
        try {
          await installFromMarket(source, skillId);
        } catch (e) {
          console.error('Install failed:', e);
        }
      },
      [installFromMarket],
    );

    const getFullId = (source: string, skillId: string) => `${source}/${skillId}`;

    const showFilters = !searchQuery && availableSources.length > 0;

    return (
      <div className="flex flex-col h-full">
        <MarketplaceSearchBar value={searchQuery} onChange={setSearchQuery} />

        {!searchQuery && (
          <LeaderboardToggle value={board} onChange={setBoard} disabled={loading} />
        )}

        {showFilters && (
          <SourceFilter
            sources={availableSources}
            value={sourceFilter}
            onChange={setSourceFilter}
            disabled={loading}
          />
        )}

        {searchQuery && (
          <div className="px-4 py-2 border-b border-border">
            <span className="text-xs text-text-muted">
              {loading ? 'Searching...' : `Results for "${searchQuery}"`}
            </span>
          </div>
        )}

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
                {searchQuery ? 'No results found' : 'No skills available'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {displayList.map(skill => {
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

        {totalItems > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            disabled={loading}
          />
        )}
      </div>
    );
  },
);

MarketplaceContent.displayName = 'MarketplaceContent';

export default MarketplaceContent;
