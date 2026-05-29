import React, { useState, useEffect, useRef } from "react";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "../../utils/idePresets";
import { useAppContext } from "../../contexts";
import AgentIcon from "../layout/AgentIcon";
import { cn } from "../../utils/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui/dialog";
import { Button } from "@/ui/button";

interface AddProjectModalProps {
   pendingPath: string;
   onConfirm: (agentId: string | null, ideCommand: string | null) => Promise<void>;
   onCancel: () => void;
   loading: boolean;
}

function AddProjectModal({
   pendingPath,
   onConfirm,
   onCancel,
   loading,
}: AddProjectModalProps) {
   const { agents, config } = useAppContext();
   const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
   const [pendingAgentOpen, setPendingAgentOpen] = useState(false);
   const pendingAgentRef = useRef<HTMLDivElement>(null);
   const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);
   const [pendingIdeOpen, setPendingIdeOpen] = useState(false);
   const pendingIdeRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!pendingIdeOpen) return;
      const handler = (e: MouseEvent) => {
         if (pendingIdeRef.current && !pendingIdeRef.current.contains(e.target as Node)) {
            setPendingIdeOpen(false);
         }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
   }, [pendingIdeOpen]);

   useEffect(() => {
      if (!pendingAgentOpen) return;
      const handler = (e: MouseEvent) => {
         if (pendingAgentRef.current && !pendingAgentRef.current.contains(e.target as Node)) {
            setPendingAgentOpen(false);
         }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
   }, [pendingAgentOpen]);

   const handleConfirm = async () => {
      let ideCommand: string | null = null;
      if (selectedIdeId) {
         if (selectedIdeId.startsWith("custom:")) {
            const idx = parseInt(selectedIdeId.replace("custom:", ""));
            ideCommand = config.customIdes?.[idx]?.command ?? null;
         } else {
            const preset = IDE_PRESETS.find((i) => i.id === selectedIdeId);
            if (preset) {
               ideCommand = config.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset);
            }
         }
      }
      await onConfirm(selectedAgentId, ideCommand);
   };

   return (
      <Dialog open onOpenChange={(open) => !open && onCancel()}>
         <DialogContent className="max-w-[500px]" key={pendingPath}>
            <DialogHeader>
               <DialogTitle>Add Project</DialogTitle>
            </DialogHeader>
            <p className="font-mono text-sm text-text-muted break-all mb-4">{pendingPath}</p>

            {/* Agent selection */}
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
               Agent
            </label>
            <div className="relative" ref={pendingAgentRef}>
               <button
                  className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                  onClick={() => setPendingAgentOpen((v) => !v)}
               >
                  {selectedAgentId ? (
                     <>
                        <AgentIcon icon={agents.find((a) => a.id === selectedAgentId)?.icon} />
                        <span className="font-medium">
                           {agents.find((a) => a.id === selectedAgentId)?.name}
                        </span>
                     </>
                  ) : (
                     <>
                        <AgentIcon icon={null} fallback="&#9889;" />
                        <span className="font-medium">None</span>
                     </>
                  )}
                  <span className="text-xs text-text-secondary ml-auto">
                     {pendingAgentOpen ? "−" : "+"}
                  </span>
               </button>
               {pendingAgentOpen && (
                  <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
                     <div
                        className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedAgentId && "bg-accent-blue text-white")}
                        onClick={() => { setSelectedAgentId(null); setPendingAgentOpen(false); }}
                     >
                        <AgentIcon icon={null} fallback="&#9889;" />
                        <span className="font-medium">None</span>
                     </div>
                     {agents
                        .filter((a) => a.enabled)
                        .map((agent) => (
                           <div
                              key={agent.id}
                              className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedAgentId === agent.id && "bg-accent-blue text-white")}
                              onClick={() => { setSelectedAgentId(agent.id); setPendingAgentOpen(false); }}
                           >
                              <AgentIcon icon={agent.icon} />
                              <span className="font-medium">{agent.name}</span>
                              <span className="ml-auto text-xs text-text-muted">{agent.command}</span>
                           </div>
                        ))}
                  </div>
               )}
            </div>

            {/* IDE selection */}
            <label className="block text-xs font-medium text-text-secondary mb-1.5 mt-3 uppercase tracking-wide">
               IDE
            </label>
            <div className="relative" ref={pendingIdeRef}>
               <button
                  className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                  onClick={() => setPendingIdeOpen((v) => !v)}
               >
                  {selectedIdeId ? (
                     <>
                        {selectedIdeId.startsWith("custom:") ? (
                           <span className="w-[18px] h-[18px] object-contain" style={{ fontSize: 16 }}>&#128187;</span>
                        ) : (
                           <img src={getIdeIconSrc(IDE_PRESETS.find((i) => i.id === selectedIdeId)?.icon)} className="w-[18px] h-[18px] object-contain" alt="" />
                        )}
                        <span className="font-medium">
                           {selectedIdeId.startsWith("custom:")
                              ? config.customIdes?.[parseInt(selectedIdeId.replace("custom:", ""))]?.name
                              : IDE_PRESETS.find((i) => i.id === selectedIdeId)?.name}
                        </span>
                     </>
                  ) : (
                     <>
                        <span className="w-[18px] h-[18px] object-contain" style={{ fontSize: 16 }}>&#128187;</span>
                        <span className="font-medium">None</span>
                     </>
                  )}
                  <span className="text-xs text-text-secondary ml-auto">
                     {pendingIdeOpen ? "−" : "+"}
                  </span>
               </button>
               {pendingIdeOpen && (
                  <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
                     <div
                        className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedIdeId && "bg-accent-blue text-white")}
                        onClick={() => { setSelectedIdeId(null); setPendingIdeOpen(false); }}
                     >
                        <span style={{ fontSize: 16 }}>&#128187;</span>
                        <span className="font-medium">None</span>
                     </div>
                     {IDE_PRESETS.map((ide) => (
                        <div
                           key={ide.id}
                           className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === ide.id && "bg-accent-blue text-white")}
                           onClick={() => { setSelectedIdeId(ide.id); setPendingIdeOpen(false); }}
                        >
                           <img src={getIdeIconSrc(ide.icon)} className="w-[18px] h-[18px] object-contain" alt="" />
                           <span className="font-medium">{ide.name}</span>
                           <span className="ml-auto text-xs text-text-muted">
                              {config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide)}
                           </span>
                        </div>
                     ))}
                     {(config.customIdes || []).map((ide, idx) => {
                        const customId = `custom:${idx}`;
                        return (
                           <div
                              key={customId}
                              className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === customId && "bg-accent-blue text-white")}
                              onClick={() => { setSelectedIdeId(customId); setPendingIdeOpen(false); }}
                           >
                              <span style={{ fontSize: 16 }}>&#128187;</span>
                              <span className="font-medium">{ide.name}</span>
                              <span className="ml-auto text-xs text-text-muted">{ide.command}</span>
                           </div>
                        );
                     })}
                  </div>
               )}
            </div>

            <DialogFooter>
               <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
               <Button variant="primary" onClick={handleConfirm} disabled={loading}>
                  {loading ? "Adding..." : "Add"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

export default React.memo(AddProjectModal);
