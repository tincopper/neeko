import React from "react";
import { SkillProvider } from "../../context/skill-context";
import PanelHeader from "../skills/PanelHeader";
import SearchBar from "../skills/SearchBar";
import TagGroupSection from "../skills/TagGroupSection";
import SkillListSection from "../skills/SkillListSection";
import ToolStatusSection from "../skills/ToolStatusSection";

interface SkillsPanelProps {
  activeProjectId: string | null;
}

const SkillsPanel: React.FC<SkillsPanelProps> = React.memo(({ activeProjectId }) => {
  return (
    <SkillProvider activeProjectId={activeProjectId}>
      <div className="flex flex-col h-full">
        <PanelHeader />
        <SearchBar />
        <div className="flex-1 overflow-y-auto">
          <TagGroupSection />
          <SkillListSection />
          <ToolStatusSection />
        </div>
      </div>
    </SkillProvider>
  );
});
SkillsPanel.displayName = "SkillsPanel";
export default SkillsPanel;
