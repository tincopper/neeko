import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "@/shared/utils/idePresets";
import AgentIcon from "@/features/agent/components/AgentIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui/dialog";
import { Button } from "@/ui/button";
import type { AppConfig, AgentConfig } from "../../../types";
import { cn } from "@/lib/utils";

interface ProjectSettingsDialogProps {
  projectId: string;
  projectName: string;
  currentAgent: string | null;
  currentIde: string | null;
  agents: AgentConfig[];
  config: AppConfig;
  onClose: () => void;
  onSave: (agentId: string | null, ideCommand: string | null) => void;
}

function ProjectSettingsDialog({
  projectId,
  projectName,
  currentAgent,
  currentIde,
  agents,
  config,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgent);
  const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [ideOpen, setIdeOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const ideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentIde) {
      const preset = IDE_PRESETS.find((i) => {
        const cmd = config.ideCommandOverrides?.[i.id] ?? getIdeCommand(i);
        return cmd === currentIde;
      });
      if (preset) {
        setSelectedIdeId(preset.id);
        return;
      }
      const customIdx = (config.customIdes ?? []).findIndex((c) => c.command === currentIde);
      if (customIdx >= 0) {
        setSelectedIdeId(`custom:${customIdx}`);
      }
    }
  }, [currentIde, config]);

  useEffect(() => {
    if (!agentOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setAgentOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentOpen]);

  useEffect(() => {
    if (!ideOpen) return;
    const handler = (e: MouseEvent) => {
      if (ideRef.current && !ideRef.current.contains(e.target as Node)) {
        setIdeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ideOpen]);

  const handleSave = useCallback(async () => {
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

    try {
      await invoke("set_project_agent", { projectId, agentId: selectedAgentId });
    } catch (e) {
      console.error("Failed to set agent:", e);
    }
    try {
      await invoke("set_project_ide", { projectId, ide: ideCommand });
    } catch (e) {
      console.error("Failed to set IDE:", e);
    }

    onSave(selectedAgentId, ideCommand);
    onClose();
  }, [projectId, selectedAgentId, selectedIdeId, config, onSave, onClose]);

  const resolveIdeDisplay = (ideId: string | null): { icon: string; name: string } => {
    if (!ideId) return { icon: "", name: "None" };
    if (ideId.startsWith("custom:")) {
      const idx = parseInt(ideId.replace("custom:", ""));
      const custom = config.customIdes?.[idx];
      return { icon: "", name: custom?.name ?? "Custom IDE" };
    }
    const preset = IDE_PRESETS.find((i) => i.id === ideId);
    return { icon: preset?.icon ?? "", name: preset?.name ?? "IDE" };
  };

  const ideDisplay = resolveIdeDisplay(selectedIdeId);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="min-w-[400px] max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>
        <p className="font-mono text-sm text-text-muted break-all mb-4">{projectName}</p>

        <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 12 }}>Agent</label>
        <div className="relative" ref={agentRef} style={{ width: "100%", marginTop: 4 }}>
          <button className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full" onClick={() => setAgentOpen((v) => !v)}>
            <AgentIcon icon={agents.find((a) => a.id === selectedAgentId)?.icon ?? null} size={16} fallback="&#9889;" />
            <span className="font-medium">{agents.find((a) => a.id === selectedAgentId)?.name ?? "None"}</span>
            <span className="text-xs text-text-secondary ml-auto">{agentOpen ? "−" : "+"}</span>
          </button>
          {agentOpen && (
            <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
              <div className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedAgentId && "bg-accent-blue text-white")}
                onClick={() => { setSelectedAgentId(null); setAgentOpen(false); }}>
                <AgentIcon icon={null} size={16} fallback="&#9889;" />
                <span className="font-medium">None</span>
              </div>
              {agents.filter((a) => a.enabled).map((agent) => (
                <div key={agent.id} className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedAgentId === agent.id && "bg-accent-blue text-white")}
                  onClick={() => { setSelectedAgentId(agent.id); setAgentOpen(false); }}>
                  <AgentIcon icon={agent.icon} size={16} />
                  <span className="font-medium">{agent.name}</span>
                  <span className="ml-auto text-xs text-text-muted">{agent.command}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 12 }}>IDE</label>
        <div className="relative" ref={ideRef} style={{ width: "100%", marginTop: 4 }}>
          <button className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full" onClick={() => setIdeOpen((v) => !v)}>
            {selectedIdeId?.startsWith("custom:") ? (
              <span className="text-[14px] w-[18px] h-[18px] object-contain" style={{ fontSize: 16 }}>&#128187;</span>
            ) : (
              <img src={getIdeIconSrc(ideDisplay.icon)} className="w-[18px] h-[18px] object-contain" alt="" />
            )}
            <span className="font-medium">{ideDisplay.name}</span>
            <span className="text-xs text-text-secondary ml-auto">{ideOpen ? "−" : "+"}</span>
          </button>
          {ideOpen && (
            <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
              <div className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedIdeId && "bg-accent-blue text-white")}
                onClick={() => { setSelectedIdeId(null); setIdeOpen(false); }}>
                <span style={{ fontSize: 16 }}>&#128187;</span>
                <span className="font-medium">None</span>
              </div>
              {IDE_PRESETS.map((ide) => (
                <div key={ide.id} className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === ide.id && "bg-accent-blue text-white")}
                  onClick={() => { setSelectedIdeId(ide.id); setIdeOpen(false); }}>
                  <img src={getIdeIconSrc(ide.icon)} className="w-[18px] h-[18px] object-contain" alt="" />
                  <span className="font-medium">{ide.name}</span>
                  <span className="ml-auto text-xs text-text-muted">{config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide)}</span>
                </div>
              ))}
              {(config.customIdes || []).map((ide, idx) => {
                const customId = `custom:${idx}`;
                return (
                  <div key={customId} className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === customId && "bg-accent-blue text-white")}
                    onClick={() => { setSelectedIdeId(customId); setIdeOpen(false); }}>
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default React.memo(ProjectSettingsDialog);
