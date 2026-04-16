import React, { useState, useCallback } from "react";
import { Search, Plus, FolderDown, Radar } from "lucide-react";
import { Button, Input } from "../ui";
import { useSkillContext } from "../../context/skill-context";
import SkillListSection from "./SkillListSection";
import CreateSkillDialog from "./CreateSkillDialog";

const LocalSkillContent: React.FC = React.memo(() => {
  const { installLocal, scanSkills, createSkill, searchQuery, setSearchQuery } = useSkillContext();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleCreate = useCallback(
    async (name: string, description?: string) => {
      await createSkill(name, description);
    },
    [createSkill]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-primary">Local Skills</span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setCreateDialogOpen(true)} className="h-7 px-2.5 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" />
            Create
          </Button>
          <Button variant="ghost" size="sm" onClick={installLocal} className="h-7 px-2.5 text-xs gap-1">
            <FolderDown className="h-3.5 w-3.5" />
            Install
          </Button>
          <Button variant="ghost" size="sm" onClick={scanSkills} className="h-7 px-2.5 text-xs gap-1">
            <Radar className="h-3.5 w-3.5" />
            Scan
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto p-2">
        <SkillListSection />
      </div>

      {/* Create dialog */}
      <CreateSkillDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onConfirm={handleCreate}
      />
    </div>
  );
});
LocalSkillContent.displayName = "LocalSkillContent";
export default LocalSkillContent;
