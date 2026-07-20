import React, { useMemo, useEffect, useState } from 'react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillDialogState } from './skillItemTypes';
import { useLocalSkillActions } from './useLocalSkillActions';
import SkillHeader from './SkillHeader';
import SkillSearchInput from './SkillSearchInput';
import SkillListSection from './SkillListSection';
import DiscoveredSkillsList from './DiscoveredSkillsList';
import { getSkillsForTagGroup } from '@/features/skill/api/skillApi';

interface LocalSkillContentProps {
  setDialog: (state: SkillDialogState) => void;
}

const LocalSkillContent: React.FC<LocalSkillContentProps> = React.memo(({ setDialog }) => {
  const skills = useSkillStore(s => s.skills);
  const loading = useSkillStore(s => s.loading);
  const searchQuery = useSkillStore(s => s.searchQuery);
  const activeTagGroupId = useSkillStore(s => s.activeTagGroupId);
  const selectedSkillId = useSkillStore(s => s.selectedSkillId);
  const tagGroups = useSkillStore(s => s.tagGroups);
  const setSearchQuery = useSkillStore(s => s.setSearchQuery);
  const fetchSkillsForTagGroup = useSkillStore(s => s.fetchSkillsForTagGroup);

  const {
    discoveredSkills,
    handleCreate,
    handleInstall,
    handleInstallGit,
    handleScan,
    handleImport,
    handleClearDiscovered,
    actions,
  } = useLocalSkillActions(setDialog);

  const [tagGroupSkills, setTagGroupSkills] = useState<typeof skills | null>(null);
  const [skillPresetMap, setSkillPresetMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!activeTagGroupId) {
      setTagGroupSkills(null);
      return;
    }
    void fetchSkillsForTagGroup(activeTagGroupId).then(setTagGroupSkills);
  }, [activeTagGroupId, fetchSkillsForTagGroup, skills]);

  useEffect(() => {
    if (tagGroups.length === 0) {
      setSkillPresetMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const map: Record<string, string[]> = {};
      await Promise.all(
        tagGroups.map(async tg => {
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
      if (!cancelled) setSkillPresetMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [tagGroups, skills]);

  const activeGroupName = useMemo(
    () => tagGroups.find(g => g.id === activeTagGroupId)?.name ?? null,
    [tagGroups, activeTagGroupId],
  );

  const filteredSkills = useMemo(() => {
    const base = tagGroupSkills ?? skills;
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)),
    );
  }, [tagGroupSkills, skills, searchQuery]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <SkillHeader
          onCreateClick={handleCreate}
          onInstallDirectoryClick={handleInstall}
          onInstallGitClick={handleInstallGit}
          onScanClick={handleScan}
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
      </div>

      {/* Scroll region — must be flex-1 + min-h-0 + overflow-y-auto */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <SkillListSection
          skills={filteredSkills}
          loading={loading && skills.length === 0}
          selectedSkillId={selectedSkillId}
          actions={actions}
          tagGroups={tagGroups.map(g => ({ id: g.id, name: g.name }))}
          presetLabel={activeGroupName}
          skillPresetMap={skillPresetMap}
        />
      </div>
    </div>
  );
});

LocalSkillContent.displayName = 'LocalSkillContent';

export default LocalSkillContent;
