import React from "react";
import { Trash2, FileText } from "lucide-react";
import { Badge } from "../ui";
import type { ManagedSkillDto } from "../../types";
import { cn } from "../../utils/cn";

interface SkillCardProps {
  skill: ManagedSkillDto;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: "detail" | "delete") => void;
}

const SkillCard: React.FC<SkillCardProps> = React.memo(({ skill, isSelected, onSelect, onAction }) => {
  return (
    <div
      className={cn(
        "flex items-start justify-between px-3 py-2 cursor-pointer rounded-sm text-xs transition-colors group",
        isSelected ? "bg-accent/15" : "hover:bg-bg-hover"
      )}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-primary truncate">{skill.name}</span>
          <Badge variant="default" className="text-[10px] px-1 py-0">
            {skill.source_type}
          </Badge>
          {skill.update_status === "up_to_date" && (
            <Badge variant="default" className="text-[10px] px-1 py-0 text-green-500">synced</Badge>
          )}
        </div>
        {skill.description && (
          <p className="text-text-muted mt-0.5 truncate">{skill.description}</p>
        )}
        {skill.tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {skill.tags.map((t) => (
              <Badge key={t} variant="default" className="text-[10px] px-1 py-0">{t}</Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 ml-1">
        <button onClick={(e) => { e.stopPropagation(); onAction("detail"); }}
          className="p-1 text-text-muted hover:text-accent rounded">
          <FileText className="h-3.5 w-3.5" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onAction("delete"); }}
          className="p-1 text-text-muted hover:text-red-400 rounded">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
SkillCard.displayName = "SkillCard";
export default SkillCard;
