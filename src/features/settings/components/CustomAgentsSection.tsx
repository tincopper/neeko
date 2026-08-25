import { Pencil } from 'lucide-react';
import React, { useState } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- settings UI resolves agent icons via agent API
import { AgentForm, CapabilityBadges } from '@/features/agent';
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { cn } from '@/lib/utils';
import { FolderIcon, PlusIcon, TrashIcon } from '@/shared/components/icons';
import type { AgentConfig, AppConfig } from '@/shared/types';
import { Button } from '@/ui';

interface CustomAgentsSectionProps {
  config: AppConfig;
  skillPathEditingAgentId: string | null;
  skillPathInputValue: string;
  onSkillPathInputValueChange: (value: string) => void;
  onSaveAgent: (agent: AgentConfig) => void;
  onRemoveAgent: (agentId: string) => void;
  onSelectSkillPath: (agent: AgentConfig) => void;
  onStartEditSkillPath: (agentId: string, currentPath: string) => void;
  onSaveSkillPath: (agent: AgentConfig) => void;
  onCancelSkillPathEdit: () => void;
}

const CustomAgentsSection: React.FC<CustomAgentsSectionProps> = ({
  config,
  skillPathEditingAgentId,
  skillPathInputValue,
  onSkillPathInputValueChange,
  onSaveAgent,
  onRemoveAgent,
  onSelectSkillPath,
  onStartEditSkillPath,
  onSaveSkillPath,
  onCancelSkillPathEdit,
}) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const customAgents = config.customAgents ?? [];

  const openCreate = () => {
    setEditingAgent(null);
    setFormOpen(true);
  };

  const openEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingAgent(null);
  };

  return (
    <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0 mt-2">
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Custom Agents</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Add custom AI agent CLIs. CLI / CHAT / Headless capabilities are declared per agent.
          </div>
        </div>
        {!formOpen && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-[0.82em]"
            onClick={openCreate}
          >
            <PlusIcon size={13} className="mr-1" />
            Add Agent
          </Button>
        )}
      </div>

      {formOpen ? (
        <div className="w-full border border-border rounded-lg bg-bg-primary overflow-hidden">
          <AgentForm
            initial={editingAgent}
            onSaved={(agent) => {
              onSaveAgent(agent);
              closeForm();
            }}
            onCancel={closeForm}
          />
        </div>
      ) : (
        customAgents.length > 0 && (
          <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
            {customAgents.map((agent) => {
              const iconSrc = resolveAgentIconSrc(agent.icon);
              const skillPathValue = agent.skill_path ?? '';
              const hasSkillPath = !!skillPathValue;
              const isEditingSkillPath = skillPathEditingAgentId === agent.id;

              return (
                <React.Fragment key={agent.id}>
                  <div className="group flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] hover:bg-bg-hover/40 transition-colors duration-150">
                    {iconSrc ? (
                      <img src={iconSrc} className="size-[18px] object-contain shrink-0" alt="" />
                    ) : (
                      <span className="size-[18px] shrink-0" />
                    )}

                    <span className="text-text-primary font-medium min-w-[100px] shrink-0">
                      {agent.name}
                    </span>

                    <span className="text-text-muted font-mono text-[0.82em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {agent.command}
                      {agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
                    </span>

                    <CapabilityBadges agent={agent} className="shrink-0" />

                    <button
                      className="bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-accent-blue hover:bg-bg-hover"
                      onClick={() => openEdit(agent)}
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-accent-red hover:bg-bg-hover"
                      onClick={() => onRemoveAgent(agent.id)}
                      title="Remove"
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5 py-[5px] px-3 pb-2 border-b border-white/[0.03] text-[0.79em] [&:last-child]:border-b-0 bg-bg-secondary/30">
                    <span className="w-[18px] shrink-0" />
                    <span className="text-text-muted min-w-[100px] shrink-0">Skill Path:</span>

                    {isEditingSkillPath ? (
                      <>
                        <input
                          className="flex-1 min-w-0 h-6 px-1.5 text-[0.82em] bg-bg-secondary border border-border rounded font-mono text-text-primary outline-none focus:border-accent-blue"
                          value={skillPathInputValue}
                          spellCheck={false}
                          onChange={(e) => onSkillPathInputValueChange(e.target.value)}
                          onBlur={() => onSaveSkillPath(agent)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onSaveSkillPath(agent);
                            }
                            if (e.key === 'Escape') {
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
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'text-text-muted font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 hover:bg-bg-hover',
                            !hasSkillPath && 'italic',
                          )}
                          title="Click to edit"
                          onClick={() => onStartEditSkillPath(agent.id, skillPathValue || '')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onStartEditSkillPath(agent.id, skillPathValue || '');
                            }
                          }}
                        >
                          {hasSkillPath ? skillPathValue : 'Not set'}
                        </span>
                      </>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};

export default React.memo(CustomAgentsSection);
