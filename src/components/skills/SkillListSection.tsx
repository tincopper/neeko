import React, { useMemo } from "react";
import SkillCard from "./SkillCard";
import { useSkillContext } from "../../context/skill-context";

const SkillListSection: React.FC = React.memo(() => {
  const { skills, searchQuery, selectedSkillId, viewSkillDetail, deleteSkill } = useSkillContext();

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
          filtered.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              isSelected={selectedSkillId === s.id}
              onSelect={() => viewSkillDetail(s.id === selectedSkillId ? null : s.id)}
              onAction={(action) => {
                if (action === "delete") deleteSkill(s.id);
                if (action === "detail") viewSkillDetail(s.id);
              }}
            />
          ))
        )}
      </div>
    </section>
  );
});
SkillListSection.displayName = "SkillListSection";
export default SkillListSection;
