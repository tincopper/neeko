import React, { useState, useCallback, useEffect } from 'react';
import { useSkillStore } from '../../../store/skillStore';
import type { SkillDialogState } from './skillItemTypes';
import LocalSkillContent from './LocalSkillContent';
import MarketplaceContent from './MarketplaceContent';
import ProjectSkillContent from './ProjectSkillContent';
import CreateSkillDialog from './CreateSkillDialog';
import EditSkillDialog from './EditSkillDialog';
import ViewSkillDialog from './ViewSkillDialog';

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Skill 内容区（作为 MainContent 内部的一种视图模式，对标 RemoteProjectView）。
 *
 * 不带 bg-bg-secondary — 复用 MainContent 的背景容器。
 * MainContent 本身永远不 unmount，因此切换至此视图时不存在 paint gap（不闪）。
 *
 * 职责：
 * - 根据 activeSkillView 路由到对应子视图
 * - 统一管理 Create / Edit / View dialog 状态
 */
const SkillContent: React.FC = React.memo(() => {
  const activeSkillView = useSkillStore(s => s.activeSkillView);
  const createSkill = useSkillStore(s => s.createSkill);
  const updateSkillDocument = useSkillStore(s => s.updateSkillDocument);
  const refreshSkills = useSkillStore(s => s.refreshSkills);
  const refreshTagGroups = useSkillStore(s => s.refreshTagGroups);

  // ── 初始数据加载（SkillContent mount 即 Skills 面板已激活）──────────────────
  useEffect(() => {
    refreshSkills();
    refreshTagGroups();
  }, [refreshSkills, refreshTagGroups]);

  // ── 统一对话框状态 ───────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<SkillDialogState>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  // ── Dialog confirm 处理 ─────────────────────────────────────────────────────
  const handleCreateConfirm = useCallback(
    async (name: string, content: string) => {
      await createSkill(name, content);
      setDialog(null);
    },
    [createSkill],
  );

  const handleEditConfirm = useCallback(
    async (name: string, content: string) => {
      if (dialog?.type !== 'edit') return;
      await updateSkillDocument(dialog.skill.id, name, content);
      setDialog(null);
    },
    [dialog, updateSkillDocument],
  );

  // ── 视图路由 ─────────────────────────────────────────────────────────────────
  const renderView = () => {
    switch (activeSkillView) {
      case 'local':
        return <LocalSkillContent setDialog={setDialog} />;
      case 'marketplace':
        return <MarketplaceContent />;
      case 'project':
        return <ProjectSkillContent />;
      default:
        return <LocalSkillContent setDialog={setDialog} />;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {renderView()}

      {/* 共享对话框：提升到根级，独立于视图切换的 mount/unmount 生命周期 */}
      <CreateSkillDialog
        open={dialog?.type === 'create'}
        onOpenChange={open => !open && closeDialog()}
        onConfirm={handleCreateConfirm}
      />

      <EditSkillDialog
        open={dialog?.type === 'edit'}
        skill={dialog?.type === 'edit' ? dialog.skill : null}
        onClose={closeDialog}
        onConfirm={handleEditConfirm}
      />

      <ViewSkillDialog
        open={dialog?.type === 'view'}
        skill={dialog?.type === 'view' ? dialog.skill : null}
        onClose={closeDialog}
      />
    </div>
  );
});

SkillContent.displayName = 'SkillContent';

export default SkillContent;
