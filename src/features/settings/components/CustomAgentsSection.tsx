import { Pencil } from 'lucide-react';
import React, { useState } from 'react';

import { AgentForm, AgentIcon, CapabilityBadges } from '@/features/agent';
import { cn } from '@/lib/utils';
import { FolderIcon, PlusIcon, TrashIcon } from '@/shared/components/icons';
import { useAgentStore } from '@/shared/store/agentStore';
import type { AgentConfig } from '@/shared/types';
import { Button, Switch } from '@/ui';

interface CustomAgentsSectionProps {
  skillPathEditingAgentId: string | null;
  skillPathInputValue: string;
  onSkillPathInputValueChange: (value: string) => void;
  /** 保存自定义 agent（落盘 + 刷新缓存）。 */
  onSaveAgent: (agent: AgentConfig) => Promise<void>;
  /** 行内启停开关（写路径与错误策略在 hook 收口，Promise 永不 reject）。 */
  onToggleAgentEnabled: (agent: AgentConfig, enabled: boolean) => Promise<void>;
  onRemoveAgent: (agentId: string) => void;
  onSelectSkillPath: (agent: AgentConfig) => void;
  onStartEditSkillPath: (agentId: string, currentPath: string) => void;
  onSaveSkillPath: (agent: AgentConfig) => void;
  onCancelSkillPathEdit: () => void;
}

const CustomAgentsSection: React.FC<CustomAgentsSectionProps> = ({
  skillPathEditingAgentId,
  skillPathInputValue,
  onSkillPathInputValueChange,
  onSaveAgent,
  onToggleAgentEnabled,
  onRemoveAgent,
  onSelectSkillPath,
  onStartEditSkillPath,
  onSaveSkillPath,
  onCancelSkillPathEdit,
}) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  // 自定义 agent = 后端快照里 `is_builtin` 为假的那批。**不读**
  // `config.customAgents` —— 那份副本已无写入者，读它会让新建/删除不反映。
  const customAgents = useAgentStore((s) => s.agents)?.filter((a) => !a.is_builtin) ?? [];
  useAgentStore((s) => s.ensure)();

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
    <div className="flex flex-col items-start gap-3 py-3 border-b border-border-subtle [&:last-child]:border-b-0 mt-2">
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Custom Agents</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Add custom AI agent CLIs. CLI / CHAT / Headless capabilities are declared per agent.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-[0.82em]"
          onClick={() => (formOpen && editingAgent === null ? closeForm() : openCreate())}
        >
          <PlusIcon size={13} className="mr-1" />
          Add Agent
        </Button>
      </div>

      {/* 新建表单：锚定在 section 顶部，列表保持可见。 */}
      {formOpen && editingAgent === null && (
        <div className="w-full border border-border rounded-lg bg-bg-primary overflow-hidden">
          <AgentForm
            initial={null}
            onSaved={async (agent) => {
              await onSaveAgent(agent);
              closeForm();
            }}
            onCancel={closeForm}
          />
        </div>
      )}

      {customAgents.length > 0 && (
        <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
          {customAgents.map((agent) => {
            const skillPathValue = agent.skill_path ?? '';
            const hasSkillPath = !!skillPathValue;
            const isEditingSkillPath = skillPathEditingAgentId === agent.id;
            /** 行内编辑：表单锚定在被编辑行下方，行本体高亮。 */
            const isEditing = editingAgent?.id === agent.id;
            /** 停用视觉：主内容压暗，开关状态本身就是另一根主动线索。 */
            const isDisabled = agent.enabled === false;

            return (
              <React.Fragment key={agent.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2.5 py-[7px] px-3 border-b border-border-subtle text-[0.86em] hover:bg-bg-hover/40 transition-colors duration-150',
                    isEditing && 'bg-accent-blue/5 shadow-[inset_2px_0_0_0_var(--accent-blue)]',
                  )}
                >
                  <AgentIcon
                    icon={agent.icon}
                    size={18}
                    className={cn(
                      'size-[18px] object-contain shrink-0',
                      isDisabled && 'opacity-50',
                    )}
                    fallback={<span className="size-[18px] shrink-0" />}
                  />

                  <span
                    className={cn(
                      'text-text-primary font-medium min-w-[100px] shrink-0',
                      isDisabled && 'opacity-50',
                    )}
                  >
                    {agent.name}
                  </span>

                  <span
                    className={cn(
                      'text-text-muted font-mono text-[0.82em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap',
                      isDisabled && 'opacity-50',
                    )}
                  >
                    {agent.command}
                    {agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
                  </span>

                  <CapabilityBadges agent={agent} className="shrink-0" />

                  {/* 启用开关：不经编辑表单直接切换；写路径与错误策略在 hook 收口。
                      单写者：若该行正展开编辑表单（打开时刻的快照），先收起 ——
                      否则表单随后 Save 会把旧 enabled 写回。 */}
                  <Switch
                    checked={agent.enabled !== false}
                    onCheckedChange={(v) => {
                      if (isEditing) closeForm();
                      void onToggleAgentEnabled(agent, v);
                    }}
                    aria-label={`${agent.name} enabled`}
                    className="shrink-0"
                  />

                  <button
                    className={cn(
                      'bg-none border-none text-text-muted cursor-pointer p-1 rounded shrink-0 transition-colors duration-150 hover:text-accent-blue hover:bg-bg-hover',
                      isEditing && 'text-accent-blue bg-bg-hover',
                    )}
                    onClick={() => (isEditing ? closeForm() : openEdit(agent))}
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

                {/* 编辑表单插在被编辑行与其 Skill Path 行之间 —— 行内锚定。
                    无内层边框盒：AgentForm 自带分区，叠套边框只会制造噪音。 */}
                {isEditing && (
                  <div className="px-3 py-3 border-b border-border-subtle bg-bg-secondary/40 animate-agents-expand">
                    <AgentForm
                      initial={editingAgent}
                      onSaved={async (a) => {
                        await onSaveAgent(a);
                        closeForm();
                      }}
                      onCancel={closeForm}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2.5 py-[5px] px-3 pb-2 border-b border-border-subtle text-[0.79em] [&:last-child]:border-b-0 bg-bg-secondary/30">
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
      )}
    </div>
  );
};

export default React.memo(CustomAgentsSection);
