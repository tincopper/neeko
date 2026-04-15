import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "../ui";
import { useSkillContext } from "../../context/skill-context";

const ToolStatusSection: React.FC = React.memo(() => {
  const { tools } = useSkillContext();
  const [expanded, setExpanded] = useState(true);

  if (tools.length === 0) return null;

  return (
    <section>
      <button
        className="flex items-center gap-1 px-3 py-1.5 w-full text-left text-[11px] font-medium text-text-muted uppercase tracking-wider hover:bg-bg-hover"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Tools
      </button>
      {expanded && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-1">
          {tools.map((tool) => (
            <div key={tool.key} className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={tool.installed} disabled className="h-3 w-3" />
              <span className={tool.installed ? "text-text-primary" : "text-text-muted"}>
                {tool.display_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
ToolStatusSection.displayName = "ToolStatusSection";
export default ToolStatusSection;
