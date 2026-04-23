import React from "react";
import { useSkillContext } from "../../contexts";
import LocalSkillContent from "./LocalSkillContent";
import MarketplaceContent from "./MarketplaceContent";
import ProjectSkillContent from "./ProjectSkillContent";

const SkillContent: React.FC = React.memo(() => {
   const { activeSkillView } = useSkillContext();

   switch (activeSkillView) {
      case "local":
         return <LocalSkillContent />;
      case "marketplace":
         return <MarketplaceContent />;
      case "project":
         return <ProjectSkillContent />;
      default:
         return <LocalSkillContent />;
   }
});
SkillContent.displayName = "SkillContent";
export default SkillContent;
