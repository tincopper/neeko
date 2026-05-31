import React from "react";
import { Trash2, FileText, Edit3, MoreHorizontal } from "@/shared/components/icons"
import { Card, CardContent, CardFooter, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Badge } from "@/ui";
import type { ManagedSkillDto } from '@/shared/types';
import { cn } from '@/lib/utils';
import { getAgentIconSrc } from '@/shared/utils/agents';

interface SkillCardProps {
   skill: ManagedSkillDto;
   isSelected: boolean;
   onSelect: () => void;
   onAction: (action: "detail" | "delete" | "edit") => void;
   installedAgents?: string[];
}

const AGENT_LIST = [
   { key: "opencode", label: "OpenCode", icon: "opencode.png" },
   { key: "claude-code", label: "Claude Code", icon: "claude-code.png" },
   { key: "gemini", label: "Gemini", icon: "gemini.png" },
   { key: "codex", label: "Codex", icon: "codex.png" },
   { key: "qoder", label: "Qoder", icon: "qoder.svg" },
   { key: "codebuddy", label: "Codebuddy", icon: "codebuddy.svg" },
];

const SkillCard: React.FC<SkillCardProps> = React.memo(({
   skill,
   isSelected,
   onSelect,
   onAction,
   installedAgents = [],
}) => {
   const renderInstalledAgents = () => {
      return AGENT_LIST.filter((agent) => installedAgents.includes(agent.key)).map((agent) => {
         const iconSrc = getAgentIconSrc(agent.icon);
         if (iconSrc) {
            return (
               <img
                  key={agent.key}
                  src={iconSrc}
                  alt={agent.label}
                  className="w-4 h-4"
                  title={agent.label}
               />
            );
         }
         return (
            <span
               key={agent.key}
               className="w-4 h-4 flex items-center justify-center text-[10px]"
               title={agent.label}
            >
               {agent.label.charAt(0)}
            </span>
         );
      });
   };

   const handleAction = (action: "detail" | "delete" | "edit") => {
      onAction(action);
   };

   const handleSelect = () => {
      onSelect();
   };


   return (
      <Card
         variant={isSelected ? "interactive" : "hoverable"}
         className={cn(
            "cursor-pointer transition-all",
            isSelected && "border-accent ring-1 ring-accent"
         )}
         onClick={handleSelect}
      >
         {/* CardHeader: 名称 + 操作菜单 */}
         <div className="flex items-start justify-between p-3 pb-2">
            <div className="min-w-0 flex-1">
               <span className="font-medium text-text-primary text-sm truncate block">
                  {skill.name}
               </span>
            </div>
            {/* 操作菜单 */}
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <button
                     className="p-1 text-text-muted hover:text-accent rounded"
                     title="Actions"
                  >
                     <MoreHorizontal className="h-4 w-4" />
                  </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-28">
                  <DropdownMenuItem
                     className="flex items-center gap-2 cursor-pointer"
                     onSelect={() => handleAction("edit")}
                  >
                     <Edit3 className="h-3 w-3" />
                      Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                     className="flex items-center gap-2 cursor-pointer"
                     onSelect={() => handleAction("detail")}
                  >
                     <FileText className="h-3 w-3" />
                      View
                  </DropdownMenuItem>
                  <DropdownMenuItem
                     className="flex items-center gap-2 cursor-pointer text-red-400"
                     onSelect={() => handleAction("delete")}
                  >
                     <Trash2 className="h-3 w-3" />
                      Delete
                  </DropdownMenuItem>
               </DropdownMenuContent>
            </DropdownMenu>
         </div>

         {/* CardContent: 描述 + 标签 */}
         <CardContent className="p-3 pt-0">
            {skill.description && (
               <p className="text-xs text-text-muted line-clamp-2 mb-2">
                  {skill.description}
               </p>
            )}
            {skill.tags.length > 0 && (
               <div className="flex gap-1 flex-wrap">
                  {skill.tags.map((tag) => (
                     <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                        {tag}
                     </Badge>
                  ))}
               </div>
            )}
         </CardContent>

         {/* CardFooter: 来源 + agents 图标 + 启用状�?*/}
         <CardFooter className="p-3 pt-0 items-center">
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {skill.source_type === "local" ? "📦 Local" : skill.source_type}
            </Badge>

            <div className="flex items-center gap-0.5 mx-2">
               {renderInstalledAgents()}
            </div>

            <div className="ml-auto flex items-center gap-1">
               <span
                  className={cn(
                     "w-2 h-2 rounded-full",
                     skill.enabled ? "bg-green-500" : "bg-text-muted"
                  )}
               />
               <span className="text-[10px] text-text-muted">
                   {skill.enabled ? "Enabled" : "Disabled"}
               </span>
            </div>
         </CardFooter>
      </Card>
   );
});

SkillCard.displayName = "SkillCard";

export default SkillCard;
