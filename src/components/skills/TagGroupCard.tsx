import React from "react";
import { MoreHorizontal } from "lucide-react";
import type { TagGroup } from "../../types";
import { cn } from "../../utils/cn";

interface TagGroupCardProps {
  tagGroup: TagGroup;
  isActive: boolean;
  onSelect: () => void;
  onAction: (action: "delete") => void;
}

const TagGroupCard: React.FC<TagGroupCardProps> = React.memo(({ tagGroup, isActive, onSelect, onAction }) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-1.5 cursor-pointer rounded-sm text-xs transition-colors",
        isActive ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-bg-hover"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate">{tagGroup.name}</span>
        <span className="text-text-muted">({tagGroup.skill_count})</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onAction("delete"); }}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 p-0.5"
      >
        <MoreHorizontal className="h-3 w-3" />
      </button>
    </div>
  );
});
TagGroupCard.displayName = "TagGroupCard";
export default TagGroupCard;
