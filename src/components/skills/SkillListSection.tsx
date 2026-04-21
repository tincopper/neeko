import React, { useMemo } from "react";
import SkillCard from "./SkillCard";
import { useSkillContext } from "../../contexts";

const SkillListSection: React.FC = React.memo(() => {
   const {
      skills,
      searchQuery,
      selectedSkillId,
      viewSkillDetail,
      deleteSkill,
      openEditSkillDialog,
      openViewSkillDialog,
   } = useSkillContext();

   console.log("[SkillListSection] rendered, openEditSkillDialog:", typeof openEditSkillDialog, "openViewSkillDialog:", typeof openViewSkillDialog);

   const filtered = useMemo(() => {
      if (!searchQuery.trim()) return skills;
      const q = searchQuery.toLowerCase();
      return skills.filter(
         (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q)) ||
            s.tags.some((t) => t.toLowerCase().includes(q))
      );
   }, [skills, searchQuery]);

   const handleAction = (action: "detail" | "delete" | "edit", skill: typeof skills[0]) => {
      console.log("[SkillListSection] handleAction:", action, "skill:", skill.name);
      if (action === "edit") {
         console.log("[SkillListSection] calling openEditSkillDialog");
         openEditSkillDialog(skill);
      } else if (action === "detail") {
         console.log("[SkillListSection] calling openViewSkillDialog");
         openViewSkillDialog(skill);
      } else if (action === "delete") {
         deleteSkill(skill.id);
      }
   };

   return (
      <section className="border-b border-border">
         <div className="px-3 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
            Skills ({filtered.length})
         </div>
         <div className="pb-1">
            {filtered.length === 0 ? (
               <div className="px-3 py-4 text-center text-xs text-text-muted">
                  {skills.length === 0 ? "No skills installed" : "No matching skills"}
               </div>
            ) : (
               <div className="grid grid-cols-4 gap-2 p-2">
                  {filtered.map((s) => (
                     <SkillCard
                        key={s.id}
                        skill={s}
                        isSelected={selectedSkillId === s.id}
                        onSelect={() => viewSkillDetail(s.id === selectedSkillId ? null : s.id)}
                        onAction={(action) => handleAction(action, s)}
                     />
                  ))}
               </div>
            )}
         </div>
      </section>
   );
});

SkillListSection.displayName = "SkillListSection";

export default SkillListSection;
