import React, { useState, useCallback } from "react";
import { useSkillContext } from "../../contexts";
import SkillHeader from "./SkillHeader";
import SkillSearchBar from "./SkillSearchBar";
import SkillListSection from "./SkillListSection";
import CreateSkillDialog from "./CreateSkillDialog";
import EditSkillDialog from "./EditSkillDialog";
import ViewSkillDialog from "./ViewSkillDialog";
import DiscoveredSkillsList from "./DiscoveredSkillsList";

const LocalSkillContent: React.FC = React.memo(() => {
  const {
    installLocal,
    scanSkills,
    createSkill,
    searchQuery,
    setSearchQuery,
    editSkillDialogOpen,
    editSkillDialogData,
    closeEditSkillDialog,
    viewSkillDialogOpen,
    viewSkillDialogData,
    closeViewSkillDialog,
    discoveredSkills,
    importDiscoveredSkill,
    clearDiscovered,
  } = useSkillContext();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleCreate = useCallback(
    async (name: string, skillContent: string) => {
      await createSkill(name, skillContent);
    },
    [createSkill]
  );

  const handleEdit = useCallback(
    async (name: string, skillContent: string) => {
      // TODO: 实现编辑保存逻辑
      console.log("Edit skill:", name, skillContent);
    },
    []
  );

  return (
    <div className="flex flex-col h-full">
      <SkillHeader
        onCreateClick={() => setCreateDialogOpen(true)}
        onInstallClick={installLocal}
        onScanClick={scanSkills}
      />

      <SkillSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
      />

      <DiscoveredSkillsList
        skills={discoveredSkills}
        onImport={importDiscoveredSkill}
        onClear={clearDiscovered}
      />

      <div className="flex-1 overflow-y-auto p-2">
        <SkillListSection />
      </div>

      <CreateSkillDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onConfirm={handleCreate}
      />

      <EditSkillDialog
        open={editSkillDialogOpen}
        skill={editSkillDialogData}
        onClose={closeEditSkillDialog}
        onConfirm={handleEdit}
      />

      <ViewSkillDialog
        open={viewSkillDialogOpen}
        skill={viewSkillDialogData}
        onClose={closeViewSkillDialog}
      />
    </div>
  );
});

LocalSkillContent.displayName = "LocalSkillContent";

export default LocalSkillContent;
