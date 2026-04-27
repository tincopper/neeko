import React, { useCallback, useState } from "react";
import { Package, Store, FolderOpen, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useSkillContext } from "../../contexts";
import type { SkillView, TagGroup } from "../../types";
import { cn } from "../../utils/cn";

interface NavItem {
   key: SkillView;
   label: string;
   icon: React.ElementType;
   count?: number;
}

const SkillsPanel: React.FC = React.memo(() => {
   const {
      activeSkillView,
      setActiveSkillView,
      skills,
      tagGroups,
      activeTagGroupId,
      setActiveTagGroupId,
      deleteTagGroup,
   } = useSkillContext();

   const [tagGroupsExpanded, setTagGroupsExpanded] = useState(true);

   const navItems: NavItem[] = [
      { key: "local", label: "Local Skills", icon: Package, count: skills.length },
      { key: "marketplace", label: "Marketplace", icon: Store },
       { key: "project", label: "Project Skills", icon: FolderOpen },
    ];

   const handleTagGroupAction = useCallback(
      (tg: TagGroup, action: string) => {
         if (action === "delete") deleteTagGroup(tg.id);
      },
      [deleteTagGroup]
   );

   const handleTagGroupSelect = useCallback(
      (tg: TagGroup) => {
         setActiveTagGroupId(tg.id === activeTagGroupId ? null : tg.id);
      },
      [activeTagGroupId, setActiveTagGroupId]
   );

   return (
      <div className="flex flex-col h-full">
         <div className="flex items-center px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">Skills</span>
         </div>

         <div className="flex-1 overflow-y-auto">
            <nav className="py-1">
               {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSkillView === item.key;
                  return (
                     <button
                        key={item.key}
                        className={cn(
                           "flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors text-left",
                           isActive
                              ? "bg-accent/15 text-accent"
                              : "text-text-secondary hover:bg-bg-hover"
                        )}
                        onClick={() => setActiveSkillView(item.key)}
                     >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate flex-1">{item.label}</span>
                        {item.count !== undefined && (
                           <span className="text-text-muted">({item.count})</span>
                        )}
                     </button>
                  );
               })}
            </nav>

            <div className="border-t border-border">
               <button
                  className="flex items-center gap-1 px-3 py-1.5 w-full text-left text-[11px] font-medium text-text-muted uppercase tracking-wider hover:bg-bg-hover"
                  onClick={() => setTagGroupsExpanded(!tagGroupsExpanded)}
               >
                  {tagGroupsExpanded ? (
                     <ChevronDown className="h-3 w-3" />
                  ) : (
                     <ChevronRight className="h-3 w-3" />
                  )}
                  Tag Groups
               </button>
               {tagGroupsExpanded && (
                  <div className="pb-1">
                     {tagGroups.map((tg) => (
                        <div
                           key={tg.id}
                           className={cn(
                              "flex items-center justify-between px-3 py-1.5 cursor-pointer text-xs transition-colors group",
                              activeTagGroupId === tg.id
                                 ? "bg-accent/15 text-accent"
                                 : "text-text-secondary hover:bg-bg-hover"
                           )}
                           onClick={() => handleTagGroupSelect(tg)}
                        >
                           <div className="flex items-center gap-2 min-w-0">
                              <span className="text-text-muted">
                                 {tg.icon ?? "\u{1F4CB}"}
                              </span>
                              <span className="truncate">{tg.name}</span>
                              <span className="text-text-muted">({tg.skill_count})</span>
                           </div>
                           <button
                              onClick={(e) => {
                                 e.stopPropagation();
                                 handleTagGroupAction(tg, "delete");
                              }}
                              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 p-0.5"
                           >
                               <Trash2 className="h-3 w-3" />
                           </button>
                        </div>
                     ))}
                     {tagGroups.length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-text-muted">
                           No tag groups
                        </div>
                     )}
                  </div>
               )}
            </div>
         </div>
      </div>
   );
});

SkillsPanel.displayName = "SkillsPanel";

export default SkillsPanel;
