import React from "react";
import type { AgentConfig, AppConfig } from '@/shared/types';
import { PRESET_AGENT_ICONS } from '@/shared/utils/agents';
import { resolveAgentIconSrc } from "@/features/agent/api/agentApi";
import { cn } from '@/lib/utils';
import { FolderIcon } from "@/shared/components/icons";
import { Input, Button } from "@/ui";

interface CustomAgentsSectionProps {
  config: AppConfig;
  skillPathEditingAgentId: string | null;
  skillPathInputValue: string;
  newAgentName: string;
  newAgentCommand: string;
  newAgentArgs: string;
  newAgentSkillPath: string;
  newAgentIcon: string;
  onSkillPathInputValueChange: (value: string) => void;
  onNewAgentNameChange: (value: string) => void;
  onNewAgentCommandChange: (value: string) => void;
  onNewAgentArgsChange: (value: string) => void;
  onNewAgentSkillPathChange: (value: string) => void;
  onNewAgentIconChange: (value: string) => void;
  onAddCustomAgent: () => void;
  onRemoveCustomAgent: (index: number) => void;
  onUploadAgentIcon: () => void;
  onSelectSkillPath: (agent: AgentConfig) => void;
  onStartEditSkillPath: (agentId: string, currentPath: string) => void;
  onSaveSkillPath: (agent: AgentConfig) => void;
  onCancelSkillPathEdit: () => void;
}

const CustomAgentsSection: React.FC<CustomAgentsSectionProps> = ({
  config,
  skillPathEditingAgentId,
  skillPathInputValue,
  newAgentName,
  newAgentCommand,
  newAgentArgs,
  newAgentSkillPath,
  newAgentIcon,
  onSkillPathInputValueChange,
  onNewAgentNameChange,
  onNewAgentCommandChange,
  onNewAgentArgsChange,
  onNewAgentSkillPathChange,
  onNewAgentIconChange,
  onAddCustomAgent,
  onRemoveCustomAgent,
  onUploadAgentIcon,
  onSelectSkillPath,
  onStartEditSkillPath,
  onSaveSkillPath,
  onCancelSkillPathEdit,
}) => {
  return (
    <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0 mt-2">
      <div className="flex-1 min-w-0">
        <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
          Custom Agents
        </div>
        <div className="text-[0.79em] text-text-muted leading-relaxed">
          Add custom AI agent CLIs by specifying a name, command, and optional
          arguments.
        </div>
      </div>

      {(config.customAgents || []).length > 0 && (
        <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
          {(config.customAgents || []).map((agent, idx) => {
            const iconSrc = resolveAgentIconSrc(agent.icon);
            const skillPathValue = agent.skill_path ?? "";
            const hasSkillPath = !!skillPathValue;

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
                    <span className="text-[0.93em] size-[18px] text-center shrink-0">
                      {""}
                    </span>
                  )}

                  <span className="text-text-primary font-medium min-w-[100px] shrink-0">
                    {agent.name}
                  </span>
                  <span className="text-text-muted font-mono text-[0.82em] flex-1">
                    {agent.command}
                    {agent.args.length > 0 ? ` ${agent.args.join(" ")}` : ""}
                  </span>
                  <button
                    className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded ml-auto shrink-0 hover:text-text-primary hover:bg-bg-hover"
                    onClick={() => onRemoveCustomAgent(idx)}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>

                <div className="flex items-center gap-2.5 py-[5px] px-3 pb-2 border-b border-white/[0.03] text-[0.79em] [&:last-child]:border-b-0 bg-bg-secondary/30">
                  <span className="w-[18px] shrink-0" />
                  <span className="text-text-muted min-w-[100px] shrink-0">
                    Skill Path:
                  </span>

                  {skillPathEditingAgentId === agent.id ? (
                    <>
                      <Input
                        className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]"
                        value={skillPathInputValue}
                        autoFocus
                        spellCheck={false}
                        onChange={(e) => onSkillPathInputValueChange(e.target.value)}
                        onBlur={() => onSaveSkillPath(agent)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onSaveSkillPath(agent);
                          }
                          if (e.key === "Escape") {
                            onCancelSkillPathEdit();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-text-primary"
                        title="Select folder"
                        onClick={() => onSelectSkillPath(agent)}
                      >
                        <FolderIcon size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-accent-blue"
                        title="Select folder"
                        onClick={() => onSelectSkillPath(agent)}
                      >
                        <FolderIcon size={14} />
                      </button>
                      <span
                        className={cn(
                          "text-text-muted font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 hover:bg-bg-hover",
                          !hasSkillPath && "italic",
                        )}
                        title="Click to edit"
                        onClick={() =>
                          onStartEditSkillPath(
                            agent.id,
                            skillPathValue || "",
                          )
                        }
                      >
                        {hasSkillPath ? skillPathValue : "Not set"}
                      </span>
                    </>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5 w-full">
        <Input
          className="py-[7px] px-2.5 text-[0.86em]"
          type="text"
          placeholder="Name, e.g. My Agent"
          value={newAgentName}
          onChange={(e) => onNewAgentNameChange(e.target.value)}
          spellCheck={false}
        />
        <Input
          className="py-[7px] px-2.5 text-[0.86em]"
          type="text"
          placeholder="Command, e.g. my-agent"
          value={newAgentCommand}
          onChange={(e) => onNewAgentCommandChange(e.target.value)}
          spellCheck={false}
        />
        <Input
          className="py-[7px] px-2.5 text-[0.86em]"
          type="text"
          placeholder="Args (comma separated), e.g. --verbose, --model gpt-4"
          value={newAgentArgs}
          onChange={(e) => onNewAgentArgsChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAddCustomAgent();
            }
          }}
          spellCheck={false}
        />
        <div className="flex items-center gap-2 py-1">
          <span className="text-[0.79em] text-text-muted shrink-0">Icon:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PRESET_AGENT_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                className={cn(
                  "w-7 h-7 rounded flex items-center justify-center border transition-colors",
                  newAgentIcon === iconName
                    ? "border-accent-blue bg-accent-blue/10"
                    : "border-transparent hover:bg-bg-hover",
                )}
                onClick={() => onNewAgentIconChange(iconName)}
                title={iconName}
              >
                <img src={resolveAgentIconSrc(iconName) ?? ""} className="w-4 h-4 object-contain" alt="" />
              </button>
            ))}
            <span className="text-text-muted mx-0.5 select-none">|</span>
            {PRESET_AGENT_ICONS.includes(newAgentIcon) ? (
              <button
                type="button"
                className="text-[0.79em] text-accent-blue hover:underline px-1 py-0.5"
                onClick={onUploadAgentIcon}
                title="Upload custom icon"
              >
                Upload
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[0.79em] text-accent-blue hover:underline px-1 py-0.5 rounded hover:bg-accent-blue/5"
                onClick={onUploadAgentIcon}
                title="Upload custom icon"
              >
                <img src={resolveAgentIconSrc(newAgentIcon) ?? ""} className="w-5 h-5 object-contain rounded" alt="" />
                <span>Upload</span>
              </button>
            )}
          </div>
        </div>
        <Input
          className="py-[7px] px-2.5 text-[0.86em]"
          type="text"
          placeholder="Skill path (optional), e.g. ~/.myagent/skills"
          value={newAgentSkillPath}
          onChange={(e) => onNewAgentSkillPathChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAddCustomAgent();
            }
          }}
          spellCheck={false}
        />
        <Button
          variant="primary"
          size="sm"
          className="self-end"
          onClick={onAddCustomAgent}
          disabled={!newAgentName.trim() || !newAgentCommand.trim()}
        >
          Add Agent
        </Button>
      </div>
    </div>
  );
};

export default React.memo(CustomAgentsSection);
