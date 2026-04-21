import React from "react";
import { Wrench } from "lucide-react";
import { Checkbox } from "../ui";
import { useSkillContext } from "../../contexts";

const ToolStatusContent: React.FC = React.memo(() => {
   const { tools } = useSkillContext();

   return (
      <div className="flex flex-col h-full">
         {/* Header */}
         <div className="flex items-center px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">Tool Status</span>
         </div>

         {/* Tool list */}
         <div className="flex-1 overflow-y-auto p-4">
            {tools.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
                  <Wrench className="h-12 w-12 opacity-30" />
                  <span className="text-xs">No tools detected</span>
               </div>
            ) : (
               <div className="grid grid-cols-2 gap-3">
                  {tools.map((tool) => (
                     <div
                        key={tool.key}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs"
                     >
                        <Checkbox checked={tool.installed} disabled className="h-3.5 w-3.5" />
                        <span className={tool.installed ? "text-text-primary" : "text-text-muted"}>
                           {tool.display_name}
                        </span>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>
   );
});
ToolStatusContent.displayName = "ToolStatusContent";
export default ToolStatusContent;
