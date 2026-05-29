import React, { useMemo } from 'react';
import { useSkillStore } from '@/features/skill/store';
import type { SkillDialogState } from './skillItemTypes';
import { useLocalSkillActions } from './useLocalSkillActions';
import SkillHeader from './SkillHeader';
import SkillSearchInput from './SkillSearchInput';
import SkillListSection from './SkillListSection';
import DiscoveredSkillsList from './DiscoveredSkillsList';

// ─── Props ───────────────────────────────────────────────────────────────────

interface LocalSkillContentProps {
  /** �?SkillContent 根级注入，触发对话框（对�?ProjectItem �?onOpenDialog�?*/
  setDialog: (state: SkillDialogState) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Local Skills 视图的纯组合层（对标 ProjectItem 的组合职责）�?
 *
 * 职责�?
 * - 消费 useLocalSkillActions hook（scan/install/dialog 触发�?
 * - �?store 读取数据，经 useMemo 过滤后传�?SkillListSection
 * - 自身不持有任何业务逻辑或对话框状�?
 */
const LocalSkillContent: React.FC<LocalSkillContentProps> = React.memo(({ setDialog }) => {
  const skills = useSkillStore(s => s.skills);
  const loading = useSkillStore(s => s.loading);
  const searchQuery = useSkillStore(s => s.searchQuery);
  const activeTagGroupId = useSkillStore(s => s.activeTagGroupId);
  const selectedSkillId = useSkillStore(s => s.selectedSkillId);
  const setSearchQuery = useSkillStore(s => s.setSearchQuery);
  const fetchSkillsForTagGroup = useSkillStore(s => s.fetchSkillsForTagGroup);

  const {
    discoveredSkills,
    handleCreate,
    handleInstall,
    handleScan,
    handleImport,
    handleClearDiscovered,
    actions,
  } = useLocalSkillActions(setDialog);

  // ── 过滤逻辑（tag group + search query）────────────────────────────────────
  // tag group 过滤通过服务端命令完成（fetchSkillsForTagGroup），
  // 此处�?useMemo 做客户端 searchQuery 二次过滤，两层过滤均在容器层完成�?
  const [tagGroupSkills, setTagGroupSkills] = React.useState<typeof skills | null>(null);

  React.useEffect(() => {
    if (!activeTagGroupId) {
      setTagGroupSkills(null);
      return;
    }
    fetchSkillsForTagGroup(activeTagGroupId).then(setTagGroupSkills);
  }, [activeTagGroupId, fetchSkillsForTagGroup]);

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
    <div className="flex flex-col h-full bg-bg-secondary">
      <SkillHeader
        onCreateClick={handleCreate}
        onInstallClick={handleInstall}
        onScanClick={handleScan}
      />

      <SkillSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search skills..."
        clearable
      />

      <DiscoveredSkillsList
        skills={discoveredSkills}
        onImport={handleImport}
        onClear={handleClearDiscovered}
      />

      <div className="flex-1 overflow-y-auto p-2">
        <SkillListSection
          skills={filteredSkills}
          loading={loading && skills.length === 0}
          selectedSkillId={selectedSkillId}
          actions={actions}
        />
      </div>
    </div>
  );
});

LocalSkillContent.displayName = 'LocalSkillContent';

export default LocalSkillContent;
