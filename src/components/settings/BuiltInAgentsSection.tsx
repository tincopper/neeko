import React from "react";
import type { AgentConfig, AppConfig } from "../../types";
import { getAgentIconSrc } from "../../utils/agents";
import { cn } from "../../utils/cn";
import { FolderIcon } from "../icons";
import { Input } from "../ui";
import { BUILTIN_AGENTS } from "./constants";

interface BuiltInAgentsSectionProps {
  config: AppConfig;
  editingPresetId: string | null;
  editingValue: string;
  skillPathEditingAgentId: string | null;
  skillPathInputValue: string;
  onConfigChange: (next: AppConfig) => void;
  onEditingValueChange: (value: string) => void;
  onSkillPathInputValueChange: (value: string) => void;
  onStartEditAgent: (agent: AgentConfig) => void;
  onSaveAgentOverride: (agentId: string) => void;
  onCancelPresetEdit: () => void;
  getEffectiveAgentCommand: (agent: AgentConfig) => string;
  getEffectiveSkillPath: (
    agentId: string,
    fallback: string | null | undefined,
  ) => string;
  onSelectSkillPath: (
    agentId: string,
    fallback: string | null | undefined,
  ) => void;
  onStartEditSkillPath: (agentId: string, currentPath: string) => void;
  onSaveSkillPath: (agentId: string, fallback: string | null | undefined) => void;
  onCancelSkillPathEdit: () => void;
}

const BuiltInAgentsSection: React.FC<BuiltInAgentsSectionProps> = ({
  config,
  editingPresetId,
  editingValue,
  skillPathEditingAgentId,
  skillPathInputValue,
  onConfigChange,
  onEditingValueChange,
  onSkillPathInputValueChange,
  onStartEditAgent,
  onSaveAgentOverride,
  onCancelPresetEdit,
  getEffectiveAgentCommand,
  getEffectiveSkillPath,
  onSelectSkillPath,
  onStartEditSkillPath,
  onSaveSkillPath,
  onCancelSkillPathEdit,
}) => {
  return (
    <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
          Built-in Agents
        </div>
        <div className="text-[0.79em] text-text-muted leading-relaxed">
          Pre-configured AI agent CLIs. Select one when adding a project or from
          the title bar.
        </div>
      </div>

      <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
        {BUILTIN_AGENTS.map((agent) => {
          const iconSrc = getAgentIconSrc(agent.icon);
          const isEditing = editingPresetId === agent.id;
          const effectiveCmd = getEffectiveAgentCommand(agent);
          const isOverridden = !!config.agentCommandOverrides?.[agent.id];
          const effectiveSkillPath = getEffectiveSkillPath(
            agent.id,
            agent.defaultSkillPath,
          );
          const hasSkillPath = !!effectiveSkillPath;

          return (
            <React.Fragment key={agent.id}>
              <div className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em]">
                {iconSrc ? (
                  <img
                    src={iconSrc}
                    className="text-[var(--font-size)] size-[18px] object-contain"
                    alt=""
                  />
                ) : (
                  <span className="text-[0.93em] size-[18px] text-center shrink-0 object-contain">
                    {""}
                  </span>
                )}

                <span className="text-text-primary font-medium min-w-[100px] shrink-0">
                  {agent.name}
                </span>

                {isEditing ? (
                  <Input
                    className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]"
                    value={editingValue}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => onEditingValueChange(e.target.value)}
                    onBlur={() => onSaveAgentOverride(agent.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onSaveAgentOverride(agent.id);
                      }
                      if (e.key === "Escape") {
                        onCancelPresetEdit();
                      }
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      "text-text-muted font-mono text-[0.82em] flex-1 min-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary",
                      isOverridden && "!text-accent-blue",
                    )}
                    title="Double-click to edit"
                    onDoubleClick={() => onStartEditAgent(agent)}
                  >
                    {effectiveCmd}
                  </span>
                )}

                {isOverridden && !isEditing && (
                  <button
                    className="bg-none border-none text-text-muted cursor-pointer text-[0.93em] py-0.5 px-1 rounded shrink-0 transition-colors duration-150 leading-none hover:text-accent-blue"
                    title="Reset to default"
                    onClick={() => {
                      const overrides = { ...(config.agentCommandOverrides || {}) };
                      delete overrides[agent.id];
                      onConfigChange({ ...config, agentCommandOverrides: overrides });
                    }}
                  >
                    &#x21BA;
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5 py-[5px] px-3 pb-2 border-b border-white/[0.03] text-[0.79em] [&:last-child]:border-b-0 bg-bg-secondary/30">
                <span className="w-[18px] shrink-0" />
                <span className="text-text-muted min-w-[100px] shrink-0">
                  Skill Path:
                </span>
                <button
                  type="button"
                  className="bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-accent-blue"
                   title="Select folder"
                  onClick={() => onSelectSkillPath(agent.id, agent.defaultSkillPath)}
                >
                  <FolderIcon size={14} />
                </button>

                {skillPathEditingAgentId === agent.id ? (
                  <Input
                    className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]"
                    value={skillPathInputValue}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => onSkillPathInputValueChange(e.target.value)}
                    onBlur={() => onSaveSkillPath(agent.id, agent.defaultSkillPath)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onSaveSkillPath(agent.id, agent.defaultSkillPath);
                      }
                      if (e.key === "Escape") {
                        onCancelSkillPathEdit();
                      }
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      "text-text-muted font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 hover:bg-bg-hover",
                      !hasSkillPath && "italic",
                    )}
                    title="Click to edit"
                    onClick={() =>
                      onStartEditSkillPath(
                        agent.id,
                        effectiveSkillPath || agent.defaultSkillPath || "",
                      )
                    }
                  >
                    {hasSkillPath
                      ? effectiveSkillPath
                      : (agent.defaultSkillPath || "Not set")}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(BuiltInAgentsSection);
