import { ChevronDown } from 'lucide-react';

import type { AgentConfig } from '@/shared/types';
import type { Step } from '@/shared/types/step';

import { useAgentMenu } from '../hooks/useAgentMenu';

import { AgentPopover } from './AgentPopover';

interface QuickActionBarProps {
  steps: Step[];
  onStepAction: (stepId: string) => void;
  onExpand: () => void;
  agents?: AgentConfig[];
  selectedAgentId?: string | null;
  installedMap?: Map<string, boolean>;
  onSelectAgent?: (agent: AgentConfig) => void;
}

export function QuickActionBar({
  steps,
  onStepAction,
  onExpand,
  agents = [],
  selectedAgentId = null,
  installedMap = new Map(),
  onSelectAgent,
}: QuickActionBarProps) {
  const {
    open: agentMenuOpen,
    anchorRef: agentBtnRef,
    handleOpen: handleOpenAgentMenu,
    handleClose: handleCloseAgentMenu,
    handleSelect: handleSelectAgent,
  } = useAgentMenu({ onSelectAgent });
  const agentStep = steps.find((s) => s.id === 'agent');
  const hasAgentMenu = agentStep?.type === 'agent' && onSelectAgent && agents.length > 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">Quick Actions</h3>
          <button
            type="button"
            className="text-[11px] text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer"
            onClick={onExpand}
          >
            Show steps
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {steps.map((step) => {
            const isAgentStep = step.type === 'agent' && hasAgentMenu;
            if (isAgentStep) {
              return (
                <div key={step.id} className="relative min-w-0">
                  <div className="quick-agent-split h-full w-full rounded-lg border border-border bg-bg-hover/40">
                    <button
                      type="button"
                      className="quick-agent-main"
                      onClick={() => {
                        if (selectedAgentId) {
                          onStepAction(step.id);
                        } else {
                          handleOpenAgentMenu();
                        }
                      }}
                    >
                      <div className="text-text-muted">{step.icon}</div>
                      <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">
                        {step.actionLabel}
                      </span>
                    </button>
                    <button
                      ref={agentBtnRef}
                      type="button"
                      className="quick-agent-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenAgentMenu();
                      }}
                      title="Choose another agent"
                      aria-expanded={agentMenuOpen}
                      aria-haspopup="menu"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={step.id}
                type="button"
                className="quick-action-card flex flex-col items-center gap-2 p-3 rounded-lg border border-border bg-bg-hover/40 text-center cursor-pointer min-w-0"
                onClick={() => onStepAction(step.id)}
              >
                <div className="text-text-muted">{step.icon}</div>
                <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">
                  {step.actionLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <AgentPopover
        open={agentMenuOpen}
        anchorRef={agentBtnRef}
        agents={agents}
        selectedAgentId={selectedAgentId}
        installedMap={installedMap}
        onSelect={handleSelectAgent}
        onClose={handleCloseAgentMenu}
      />
    </div>
  );
}
