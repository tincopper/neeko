import { useState, useEffect, useRef } from "react";
import { IDE_PRESETS, getIdeCommand } from "../utils/idePresets";
import type { AppConfig } from "./SettingsPanel";

interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  icon: string | null;
  enabled: boolean;
}

interface AddProjectModalProps {
  pendingPath: string;
  agents: AgentConfig[];
  config: AppConfig;
  onConfirm: (agentId: string | null, ideCommand: string | null) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

export default function AddProjectModal({
  pendingPath,
  agents,
  config,
  onConfirm,
  onCancel,
  loading,
}: AddProjectModalProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [pendingAgentOpen, setPendingAgentOpen] = useState(false);
  const pendingAgentRef = useRef<HTMLDivElement>(null);
  const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);
  const [pendingIdeOpen, setPendingIdeOpen] = useState(false);
  const pendingIdeRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭 dropdown
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
    <div className="modal-overlay">
      <div className="modal" key={pendingPath}>
        <h3>Add Project</h3>
        <p className="modal-path">{pendingPath}</p>

        {/* Agent 选择 */}
        <label className="gh-dialog-label" style={{ marginTop: 12 }}>
          Agent
        </label>
        <div
          className="agent-selector"
          ref={pendingAgentRef}
          style={{ width: "100%", marginTop: 4 }}
        >
          <button
            className="agent-dropdown-btn"
            style={{ width: "100%" }}
            onClick={() => setPendingAgentOpen((v) => !v)}
          >
            {selectedAgentId ? (
              <>
                <span className="agent-icon">
                  {agents.find((a) => a.id === selectedAgentId)?.icon || "🤖"}
                </span>
                <span className="agent-name">
                  {agents.find((a) => a.id === selectedAgentId)?.name}
                </span>
              </>
            ) : (
              <>
                <span className="agent-icon">⚡</span>
                <span className="agent-name">None</span>
              </>
            )}
            <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>
              {pendingAgentOpen ? "−" : "+"}
            </span>
          </button>
          {pendingAgentOpen && (
            <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
              <div
                className={`agent-option${!selectedAgentId ? " selected" : ""}`}
                onClick={() => { setSelectedAgentId(null); setPendingAgentOpen(false); }}
              >
                <span className="agent-icon">⚡</span>
                <span className="agent-name">None</span>
              </div>
              {agents
                .filter((a) => a.enabled)
                .map((agent) => (
                  <div
                    key={agent.id}
                    className={`agent-option${selectedAgentId === agent.id ? " selected" : ""}`}
                    onClick={() => { setSelectedAgentId(agent.id); setPendingAgentOpen(false); }}
                  >
                    <span className="agent-icon">{agent.icon || "🤖"}</span>
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-command">{agent.command}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* IDE 选择 */}
        <label className="gh-dialog-label" style={{ marginTop: 12 }}>
          IDE
        </label>
        <div
          className="agent-selector"
          ref={pendingIdeRef}
          style={{ width: "100%", marginTop: 4 }}
        >
          <button
            className="agent-dropdown-btn"
            style={{ width: "100%" }}
            onClick={() => setPendingIdeOpen((v) => !v)}
          >
            {selectedIdeId ? (
              <>
                <span className="agent-icon">
                  {selectedIdeId.startsWith("custom:")
                    ? "💻"
                    : IDE_PRESETS.find((i) => i.id === selectedIdeId)?.icon}
                </span>
                <span className="agent-name">
                  {selectedIdeId.startsWith("custom:")
                    ? config.customIdes?.[parseInt(selectedIdeId.replace("custom:", ""))]?.name
                    : IDE_PRESETS.find((i) => i.id === selectedIdeId)?.name}
                </span>
              </>
            ) : (
              <>
                <span className="agent-icon">💻</span>
                <span className="agent-name">None</span>
              </>
            )}
            <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>
              {pendingIdeOpen ? "−" : "+"}
            </span>
          </button>
          {pendingIdeOpen && (
            <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
              <div
                className={`agent-option${!selectedIdeId ? " selected" : ""}`}
                onClick={() => { setSelectedIdeId(null); setPendingIdeOpen(false); }}
              >
                <span className="agent-icon">💻</span>
                <span className="agent-name">None</span>
              </div>
              {IDE_PRESETS.map((ide) => (
                <div
                  key={ide.id}
                  className={`agent-option${selectedIdeId === ide.id ? " selected" : ""}`}
                  onClick={() => { setSelectedIdeId(ide.id); setPendingIdeOpen(false); }}
                >
                  <span className="agent-icon">{ide.icon}</span>
                  <span className="agent-name">{ide.name}</span>
                  <span className="agent-command">
                    {config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide)}
                  </span>
                </div>
              ))}
              {(config.customIdes || []).map((ide, idx) => {
                const customId = `custom:${idx}`;
                return (
                  <div
                    key={customId}
                    className={`agent-option${selectedIdeId === customId ? " selected" : ""}`}
                    onClick={() => { setSelectedIdeId(customId); setPendingIdeOpen(false); }}
                  >
                    <span className="agent-icon">💻</span>
                    <span className="agent-name">{ide.name}</span>
                    <span className="agent-command">{ide.command}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="confirm-btn" onClick={handleConfirm} disabled={loading}>
            {loading ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
