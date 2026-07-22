import React, { useState, useCallback, useEffect } from 'react';

import { useSkillStore } from '@/features/skill/store';

import AgentSkillContent from './AgentSkillContent';
import AssignTagGroupDialog from './AssignTagGroupDialog';
import CreateSkillDialog from './CreateSkillDialog';
import EditSkillDialog from './EditSkillDialog';
import GitInstallDialog from './GitInstallDialog';
import LocalSkillContent from './LocalSkillContent';
import MarketplaceContent from './MarketplaceContent';
import ProjectSkillContent from './ProjectSkillContent';
import type { SkillDialogState } from './skillItemTypes';
import ViewSkillDialog from './ViewSkillDialog';

/**
 * Skill 内容区：路由子视图 + 统一管理对话框。
 * 必须占满父级高度，否则内部 overflow-y-auto 无法滚动。
 */
const SkillContent: React.FC = React.memo(() => {
  const activeSkillView = useSkillStore((s) => s.activeSkillView);
  const createSkill = useSkillStore((s) => s.createSkill);
  const updateSkillDocument = useSkillStore((s) => s.updateSkillDocument);
  const refreshSkills = useSkillStore((s) => s.refreshSkills);
  const refreshTagGroups = useSkillStore((s) => s.refreshTagGroups);
  const tagGroups = useSkillStore((s) => s.tagGroups);
  const addSkillToTagGroup = useSkillStore((s) => s.addSkillToTagGroup);

  useEffect(() => {
    void refreshSkills();
    void refreshTagGroups();
  }, [refreshSkills, refreshTagGroups]);

  const [dialog, setDialog] = useState<SkillDialogState>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  const handleCreateConfirm = useCallback(
    async (name: string, content: string) => {
      try {
        await createSkill(name, content);
        setDialog(null);
      } catch (e) {
        console.error('[SkillContent] createSkill failed:', e);
      }
    },
    [createSkill],
  );

  const handleEditConfirm = useCallback(
    async (name: string, content: string) => {
      if (dialog?.type !== 'edit') return;
      try {
        await updateSkillDocument(dialog.skill.id, name, content);
        setDialog(null);
      } catch (e) {
        console.error('[SkillContent] updateSkillDocument failed:', e);
      }
    },
    [dialog, updateSkillDocument],
  );

  const handleGitInstalled = useCallback(async () => {
    await refreshSkills();
  }, [refreshSkills]);

  const handleAssign = useCallback(
    async (skillId: string, tagGroupId: string) => {
      await addSkillToTagGroup(tagGroupId, skillId);
    },
    [addSkillToTagGroup],
  );

  const openAssignDialog = useCallback((skillId: string, skillName: string) => {
    setDialog({ type: 'assign-tag', skillId, skillName });
  }, []);

  const renderView = () => {
    switch (activeSkillView) {
      case 'local':
        return <LocalSkillContent setDialog={setDialog} />;
      case 'marketplace':
        return <MarketplaceContent onSkillInstalled={openAssignDialog} />;
      case 'project':
        return <ProjectSkillContent setDialog={setDialog} />;
      case 'agents':
        return <AgentSkillContent setDialog={setDialog} />;
      default:
        return <LocalSkillContent setDialog={setDialog} />;
    }
  };

  return (
    <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{renderView()}</div>

      <CreateSkillDialog
        open={dialog?.type === 'create'}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={handleCreateConfirm}
      />

      <EditSkillDialog
        open={dialog?.type === 'edit'}
        skill={dialog?.type === 'edit' ? dialog.skill : null}
        onClose={closeDialog}
        onConfirm={handleEditConfirm}
      />

      <ViewSkillDialog
        open={dialog?.type === 'view' || dialog?.type === 'view-disk'}
        skill={dialog?.type === 'view' ? dialog.skill : null}
        diskSkill={dialog?.type === 'view-disk' ? dialog.skill : null}
        onClose={closeDialog}
      />

      <GitInstallDialog
        open={dialog?.type === 'git-install'}
        onOpenChange={(open) => !open && closeDialog()}
        onInstalled={handleGitInstalled}
      />

      <AssignTagGroupDialog
        open={dialog?.type === 'assign-tag'}
        skillId={dialog?.type === 'assign-tag' ? dialog.skillId : ''}
        skillName={dialog?.type === 'assign-tag' ? dialog.skillName : ''}
        tagGroups={tagGroups}
        onClose={closeDialog}
        onAssign={handleAssign}
        onSkip={closeDialog}
      />
    </div>
  );
});

SkillContent.displayName = 'SkillContent';

export default SkillContent;
