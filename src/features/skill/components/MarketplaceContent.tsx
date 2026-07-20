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
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 h-11 px-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Install Skills</h2>
          {totalItems > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
              {totalItems}
            </span>
          )}
        </div>

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

        {searchQuery ? (
          <div className="px-4 py-1.5 border-b border-border shrink-0">
            <span className="text-[11px] text-text-muted">
              {loading ? 'Searching…' : `Results for “${searchQuery}”`}
            </span>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              <Loader2 className="h-5 w-5 animate-spin opacity-50" />
              <span className="text-[11px]">Loading…</span>
            </div>
          ) : displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2 px-6">
              <div className="w-11 h-11 rounded-xl bg-bg-hover flex items-center justify-center">
                <Store className="h-5 w-5 opacity-50" />
              </div>
              <span className="text-[var(--font-size)] text-text-secondary">
                {searchQuery ? 'No results' : 'No skills available'}
              </span>
            </div>
          ) : (
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 content-start">
              {displayList.map(skill => {
                const fullId = getFullId(skill.source, skill.skill_id);
                return (
                  <MarketSkillCard
                    key={skill.id}
                    skill={skill}
                    isInstalled={isInstalled(skill.skill_id)}
                    isInstalling={installingIds.has(fullId)}
                    installPhase={installProgress.get(fullId)}
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
