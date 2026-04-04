import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "../../utils/idePresets";
import AgentIcon from "../layout/AgentIcon";
import type { AppConfig, AgentConfig } from "../../types";

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

export default function ProjectSettingsDialog({
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Project Settings</h3>
        <p className="modal-path">{projectName}</p>

        <label className="gh-dialog-label" style={{ marginTop: 12 }}>Agent</label>
        <div className="agent-selector" ref={agentRef} style={{ width: "100%", marginTop: 4 }}>
          <button className="agent-dropdown-btn" style={{ width: "100%" }} onClick={() => setAgentOpen((v) => !v)}>
            <AgentIcon icon={agents.find((a) => a.id === selectedAgentId)?.icon ?? null} size={16} fallback="⚡" />
            <span className="agent-name">{agents.find((a) => a.id === selectedAgentId)?.name ?? "None"}</span>
            <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>{agentOpen ? "−" : "+"}</span>
          </button>
          {agentOpen && (
            <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
              <div className={`agent-option${!selectedAgentId ? " selected" : ""}`}
                onClick={() => { setSelectedAgentId(null); setAgentOpen(false); }}>
                <AgentIcon icon={null} size={16} fallback="⚡" />
                <span className="agent-name">None</span>
              </div>
              {agents.filter((a) => a.enabled).map((agent) => (
                <div key={agent.id} className={`agent-option${selectedAgentId === agent.id ? " selected" : ""}`}
                  onClick={() => { setSelectedAgentId(agent.id); setAgentOpen(false); }}>
                  <AgentIcon icon={agent.icon} size={16} />
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-command">{agent.command}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="gh-dialog-label" style={{ marginTop: 12 }}>IDE</label>
        <div className="agent-selector" ref={ideRef} style={{ width: "100%", marginTop: 4 }}>
          <button className="agent-dropdown-btn" style={{ width: "100%" }} onClick={() => setIdeOpen((v) => !v)}>
            {selectedIdeId?.startsWith("custom:") ? (
              <span className="agent-icon" style={{ fontSize: 16 }}>💻</span>
            ) : (
              <img src={getIdeIconSrc(ideDisplay.icon)} className="agent-icon" alt="" />
            )}
            <span className="agent-name">{ideDisplay.name}</span>
            <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>{ideOpen ? "−" : "+"}</span>
          </button>
          {ideOpen && (
            <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
              <div className={`agent-option${!selectedIdeId ? " selected" : ""}`}
                onClick={() => { setSelectedIdeId(null); setIdeOpen(false); }}>
                <span className="agent-icon" style={{ fontSize: 16 }}>💻</span>
                <span className="agent-name">None</span>
              </div>
              {IDE_PRESETS.map((ide) => (
                <div key={ide.id} className={`agent-option${selectedIdeId === ide.id ? " selected" : ""}`}
                  onClick={() => { setSelectedIdeId(ide.id); setIdeOpen(false); }}>
                  <img src={getIdeIconSrc(ide.icon)} className="agent-icon" alt="" />
                  <span className="agent-name">{ide.name}</span>
                  <span className="agent-command">{config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide)}</span>
                </div>
              ))}
              {(config.customIdes || []).map((ide, idx) => {
                const customId = `custom:${idx}`;
                return (
                  <div key={customId} className={`agent-option${selectedIdeId === customId ? " selected" : ""}`}
                    onClick={() => { setSelectedIdeId(customId); setIdeOpen(false); }}>
                    <span className="agent-icon" style={{ fontSize: 16 }}>💻</span>
                    <span className="agent-name">{ide.name}</span>
                    <span className="agent-command">{ide.command}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button className="confirm-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
