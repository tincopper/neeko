import React, { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import TagGroupCard from "./TagGroupCard";
import { useSkillContext } from "../../contexts";
import type { TagGroup } from "../../types";

const TagGroupSection: React.FC = React.memo(() => {
   const { tagGroups, activeTagGroupId, setActiveTagGroupId, deleteTagGroup } = useSkillContext();
   const [expanded, setExpanded] = useState(true);

   const handleAction = useCallback((tg: TagGroup, action: string) => {
      if (action === "delete") deleteTagGroup(tg.id);
   }, [deleteTagGroup]);

   return (
      <section className="border-b border-border">
         <button
            className="flex items-center gap-1 px-3 py-1.5 w-full text-left text-[11px] font-medium text-text-muted uppercase tracking-wider hover:bg-bg-hover"
            onClick={() => setExpanded(!expanded)}
         >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Tag Groups
         </button>
         {expanded && (
            <div className="pb-1">
               {tagGroups.map((tg) => (
                  <TagGroupCard
                     key={tg.id}
                     tagGroup={tg}
                     isActive={activeTagGroupId === tg.id}
                     onSelect={() => setActiveTagGroupId(tg.id === activeTagGroupId ? null : tg.id)}
                     onAction={(action) => handleAction(tg, action)}
                  />
               ))}
            </div>
         )}
      </section>
   );
});
TagGroupSection.displayName = "TagGroupSection";
export default TagGroupSection;
