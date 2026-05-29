import React from "react";
import { FolderOpen } from "@/components/icons"

const ProjectSkillContent: React.FC = React.memo(() => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
      <FolderOpen className="h-12 w-12 opacity-30" />
      <span className="text-sm">Project Skills</span>
      <span className="text-xs">Coming soon</span>
    </div>
  );
});
ProjectSkillContent.displayName = "ProjectSkillContent";
export default ProjectSkillContent;
