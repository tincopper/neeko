import React from "react";
import { useSkillContext } from "../../context/skill-context";
import LocalSkillContent from "./LocalSkillContent";
import MarketplaceContent from "./MarketplaceContent";
import ProjectSkillContent from "./ProjectSkillContent";
import ToolStatusContent from "./ToolStatusContent";

const SkillContent: React.FC = React.memo(() => {
  const { activeSkillView } = useSkillContext();

  switch (activeSkillView) {
    case "local":
      return <LocalSkillContent />;
    case "marketplace":
      return <MarketplaceContent />;
    case "project":
      return <ProjectSkillContent />;
    case "tools":
      return <ToolStatusContent />;
    default:
      return <LocalSkillContent />;
  }
});
SkillContent.displayName = "SkillContent";
export default SkillContent;
