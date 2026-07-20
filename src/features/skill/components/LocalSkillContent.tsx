import React, { useMemo } from 'react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillDialogState } from './skillItemTypes';
import { useLocalSkillActions } from './useLocalSkillActions';
import SkillHeader from './SkillHeader';
import SkillSearchInput from './SkillSearchInput';
import SkillListSection from './SkillListSection';
import DiscoveredSkillsList from './DiscoveredSkillsList';

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

  const [tagGroupSkills, setTagGroupSkills] = React.useState<typeof skills | null>(null);

  React.useEffect(() => {
    if (!activeTagGroupId) {
      setTagGroupSkills(null);
      return;
    }
    void fetchSkillsForTagGroup(activeTagGroupId).then(setTagGroupSkills);
  }, [activeTagGroupId, fetchSkillsForTagGroup, skills]);

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
    <div className="flex flex-col h-full min-h-0">
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
          activeGroupName ? `Filter in ${activeGroupName}…` : 'Filter skills…'
        }
        clearable
      />

      <DiscoveredSkillsList
        skills={discoveredSkills}
        onImport={handleImport}
        onClear={handleClearDiscovered}
      />

      <div className="flex-1 overflow-y-auto min-h-0">
        <SkillListSection
          skills={filteredSkills}
          loading={loading && skills.length === 0}
          selectedSkillId={selectedSkillId}
          actions={actions}
          tagGroups={tagGroups.map(g => ({ id: g.id, name: g.name }))}
          presetLabel={activeGroupName}
        />
      </div>
    </div>
  );
});

LocalSkillContent.displayName = 'LocalSkillContent';

export default LocalSkillContent;
