import React from "react";
import { Button } from "../ui";
import { useSkillContext } from "../../context/skill-context";

const PanelHeader: React.FC = React.memo(() => {
  const { installLocal, scanSkills } = useSkillContext();

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
      <span className="text-sm font-semibold text-text-primary">Skills</span>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={installLocal} className="h-6 px-2 text-xs">
          + Install
        </Button>
        <Button variant="ghost" size="sm" onClick={scanSkills} className="h-6 px-2 text-xs">
          Scan
        </Button>
      </div>
    </div>
  );
});
PanelHeader.displayName = "PanelHeader";
export default PanelHeader;
