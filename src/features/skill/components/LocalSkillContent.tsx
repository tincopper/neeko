import React, { useMemo, useEffect, useState } from 'react';

import { listAgents } from '@/features/agent/api/agentApi';
import { getSkillsForTagGroup } from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';

import DiscoveredSkillsList from './DiscoveredSkillsList';
import SkillHeader from './SkillHeader';
import type { SkillDialogState } from './skillItemTypes';
import SkillListSection from './SkillListSection';
import SkillSearchInput from './SkillSearchInput';
import SourceTypeFilter from './SourceTypeFilter';
import TagCloudFilter from './TagCloudFilter';
import { useLocalSkillActions } from './useLocalSkillActions';

interface LocalSkillContentProps {
  setDialog: (state: SkillDialogState) => void;
}

const LocalSkillContent: React.FC<LocalSkillContentProps> = React.memo(({ setDialog }) => {
  const skills = useSkillStore((s) => s.skills);
  const loading = useSkillStore((s) => s.loading);
  const searchQuery = useSkillStore((s) => s.searchQuery);
  const activeTagGroupId = useSkillStore((s) => s.activeTagGroupId);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const tagGroups = useSkillStore((s) => s.tagGroups);
  const sourceFilter = useSkillStore((s) => s.sourceFilter);
  const tagFilter = useSkillStore((s) => s.tagFilter);
  const setSearchQuery = useSkillStore((s) => s.setSearchQuery);
  const fetchSkillsForTagGroup = useSkillStore((s) => s.fetchSkillsForTagGroup);
  const patchSkillDescription = useSkillStore((s) => s.patchSkillDescription);
  const toggleTagFilter = useSkillStore((s) => s.toggleTagFilter);

  const {
    discoveredSkills,
    scanning,
    refreshingMeta,
    handleCreate,
    handleInstall,
    handleInstallGit,
    handleScan,
    handleRefreshMetadata,
    handleImport,
    handleClearDiscovered,
    actions,
  } = useLocalSkillActions(setDialog);

  const [tagGroupSkills, setTagGroupSkills] = useState<typeof skills | null>(null);
  const [skillTagGroupMap, setSkillTagGroupMap] = useState<Record<string, string[]>>({});
  const [agents, setAgents] = useState<Array<{ id: string; icon: string | null; name: string }>>(
    [],
  );

  useEffect(() => {
    if (!activeTagGroupId) {
      setTagGroupSkills(null);
      return;
    }
    void fetchSkillsForTagGroup(activeTagGroupId).then(setTagGroupSkills);
  }, [activeTagGroupId, fetchSkillsForTagGroup, skills]);

  useEffect(() => {
    void listAgents().then((agents) => {
      setAgents(agents.map((a) => ({ id: a.id, icon: a.icon ?? null, name: a.name })));
    });
  }, []);

  useEffect(() => {
    if (!activeTagGroupId) {
      setTagGroupSkills(null);
      return;
    }
    void fetchSkillsForTagGroup(activeTagGroupId).then(setTagGroupSkills);
  }, [activeTagGroupId, fetchSkillsForTagGroup, skills]);

  useEffect(() => {
    if (tagGroups.length === 0) {
      setSkillTagGroupMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const map: Record<string, string[]> = {};
      await Promise.all(
        tagGroups.map(async (tg) => {
          try {
            const list = await getSkillsForTagGroup(tg.id);
            for (const s of list) {
              (map[s.id] ??= []).push(tg.name);
            }
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled) setSkillTagGroupMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [tagGroups, skills]);

  const activeGroupName = useMemo(
    () => tagGroups.find((g) => g.id === activeTagGroupId)?.name ?? null,
    [tagGroups, activeTagGroupId],
  );

  const baseSkills = tagGroupSkills ?? skills;

  const filteredSkills = useMemo(() => {
    let list = baseSkills;
    if (sourceFilter !== 'all') {
      list = list.filter((s) => s.source_type === sourceFilter);
    }
    if (tagFilter.length > 0) {
      list = list.filter((s) => s.tags.some((t) => tagFilter.includes(t)));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [baseSkills, sourceFilter, tagFilter, searchQuery]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <SkillHeader
          onCreateClick={handleCreate}
          onInstallDirectoryClick={handleInstall}
          onInstallGitClick={handleInstallGit}
          onScanClick={handleScan}
          scanning={scanning}
          onRefreshMetadataClick={handleRefreshMetadata}
          refreshingMeta={refreshingMeta}
          filterLabel={activeGroupName}
          count={filteredSkills.length}
        />
        <SkillSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={
            activeGroupName
              ? `Search skills in ${activeGroupName}…`
              : 'Search skills in the library…'
          }
          clearable
        />
        <DiscoveredSkillsList
          skills={discoveredSkills}
          onImport={handleImport}
          onClear={handleClearDiscovered}
        />
        <SourceTypeFilter />
        <TagCloudFilter skills={baseSkills} />
      </div>

      {/* Scroll region — must be flex-1 + min-h-0 + overflow-y-auto */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar">
        <SkillListSection
          skills={filteredSkills}
          loading={loading && skills.length === 0}
          selectedSkillId={selectedSkillId}
          actions={actions}
          tagGroups={tagGroups.map((g) => ({ id: g.id, name: g.name }))}
          tagGroupLabel={activeGroupName}
          skillTagGroupMap={skillTagGroupMap}
          agents={agents}
          onDescriptionResolved={patchSkillDescription}
          onTagClick={toggleTagFilter}
        />
      </div>
    </div>
  );
});

LocalSkillContent.displayName = 'LocalSkillContent';

export default LocalSkillContent;
