import React from "react";
import type { AgentConfig, AppConfig } from '@/shared/types';
import { Switch } from "@/ui";
import BuiltInAgentsSection from "./BuiltInAgentsSection";
import CustomAgentsSection from "./CustomAgentsSection";

interface AgentsPanelProps {
  config: AppConfig;
  builtinAgents: AgentConfig[];
  editingPresetId: string | null;
  editingValue: string;
  skillPathEditingAgentId: string | null;
  skillPathInputValue: string;
  newAgentName: string;
  newAgentCommand: string;
  newAgentArgs: string;
  newAgentSkillPath: string;
  newAgentIcon: string;
  onConfigChange: (next: AppConfig) => void;
  onEditingValueChange: (value: string) => void;
  onSkillPathInputValueChange: (value: string) => void;
  onNewAgentNameChange: (value: string) => void;
  onNewAgentCommandChange: (value: string) => void;
  onNewAgentArgsChange: (value: string) => void;
  onNewAgentSkillPathChange: (value: string) => void;
  onNewAgentIconChange: (value: string) => void;
  onAddCustomAgent: () => void;
  onRemoveCustomAgent: (index: number) => void;
  onUploadAgentIcon: () => void;
  onStartEditAgent: (agent: AgentConfig) => void;
  onSaveAgentOverride: (agentId: string) => void;
  onCancelPresetEdit: () => void;
  getEffectiveAgentCommand: (agent: AgentConfig) => string;
  onSelectSkillPath: (agent: AgentConfig) => void;
  onStartEditSkillPath: (agentId: string, currentPath: string) => void;
  onSaveSkillPath: (agent: AgentConfig) => void;
  onCancelSkillPathEdit: () => void;
}

const AgentsPanel: React.FC<AgentsPanelProps> = ({
  config,
  builtinAgents,
  editingPresetId,
  editingValue,
  skillPathEditingAgentId,
  skillPathInputValue,
  newAgentName,
  newAgentCommand,
  newAgentArgs,
  newAgentSkillPath,
  newAgentIcon,
  onConfigChange,
  onEditingValueChange,
  onSkillPathInputValueChange,
  onNewAgentNameChange,
  onNewAgentCommandChange,
  onNewAgentArgsChange,
  onNewAgentSkillPathChange,
  onNewAgentIconChange,
  onAddCustomAgent,
  onRemoveCustomAgent,
  onUploadAgentIcon,
  onStartEditAgent,
  onSaveAgentOverride,
  onCancelPresetEdit,
  getEffectiveAgentCommand,
  onSelectSkillPath,
  onStartEditSkillPath,
  onSaveSkillPath,
  onCancelSkillPathEdit,
}) => {
  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Agents</h3>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04]">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Show Agent Bar
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Display agent buttons in the title bar for quick selection.
          </div>
        </div>
        <Switch
          checked={config.agentSelectorShowPresetBar !== false}
          onCheckedChange={(checked) =>
            onConfigChange({
              ...config,
              agentSelectorShowPresetBar: checked,
            })
          }
        />
      </div>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04]">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Compact Mode
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Show only icons in the agent bar.
          </div>
        </div>
        <Switch
          checked={config.agentSelectorCompactMode}
          onCheckedChange={(checked) =>
            onConfigChange({
              ...config,
              agentSelectorCompactMode: checked,
            })
          }
        />
      </div>

      <BuiltInAgentsSection
        config={config}
        builtinAgents={builtinAgents}
        editingPresetId={editingPresetId}
        editingValue={editingValue}
        skillPathEditingAgentId={skillPathEditingAgentId}
        skillPathInputValue={skillPathInputValue}
        onConfigChange={onConfigChange}
        onEditingValueChange={onEditingValueChange}
        onSkillPathInputValueChange={onSkillPathInputValueChange}
        onStartEditAgent={onStartEditAgent}
        onSaveAgentOverride={onSaveAgentOverride}
        onCancelPresetEdit={onCancelPresetEdit}
        getEffectiveAgentCommand={getEffectiveAgentCommand}
        onSelectSkillPath={onSelectSkillPath}
        onStartEditSkillPath={onStartEditSkillPath}
        onSaveSkillPath={onSaveSkillPath}
        onCancelSkillPathEdit={onCancelSkillPathEdit}
      />

      <CustomAgentsSection
        config={config}
        skillPathEditingAgentId={skillPathEditingAgentId}
        skillPathInputValue={skillPathInputValue}
        newAgentName={newAgentName}
        newAgentCommand={newAgentCommand}
        newAgentArgs={newAgentArgs}
        newAgentSkillPath={newAgentSkillPath}
        newAgentIcon={newAgentIcon}
        onSkillPathInputValueChange={onSkillPathInputValueChange}
        onNewAgentNameChange={onNewAgentNameChange}
        onNewAgentCommandChange={onNewAgentCommandChange}
        onNewAgentArgsChange={onNewAgentArgsChange}
        onNewAgentSkillPathChange={onNewAgentSkillPathChange}
        onNewAgentIconChange={onNewAgentIconChange}
        onAddCustomAgent={onAddCustomAgent}
        onRemoveCustomAgent={onRemoveCustomAgent}
        onUploadAgentIcon={onUploadAgentIcon}
        onSelectSkillPath={onSelectSkillPath}
        onStartEditSkillPath={onStartEditSkillPath}
        onSaveSkillPath={onSaveSkillPath}
        onCancelSkillPathEdit={onCancelSkillPathEdit}
      />
    </>
  );
};

export default React.memo(AgentsPanel);
