import React from "react";
import { Search } from "lucide-react";
import { Button, Input } from "../ui";
import { useSkillContext } from "../../context/skill-context";
import SkillListSection from "./SkillListSection";

const LocalSkillContent: React.FC = React.memo(() => {
  const { installLocal, scanSkills, searchQuery, setSearchQuery } = useSkillContext();

  return (
    <div className="flex flex-col h-full">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-primary">Local Skills</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={installLocal} className="h-7 px-3 text-xs">
            + Install
          </Button>
          <Button variant="ghost" size="sm" onClick={scanSkills} className="h-7 px-3 text-xs">
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
    </div>
  );
});
LocalSkillContent.displayName = "LocalSkillContent";
export default LocalSkillContent;
