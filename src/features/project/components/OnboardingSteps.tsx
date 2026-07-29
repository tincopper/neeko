import { ChevronDown } from 'lucide-react';

import type { AgentConfig } from '@/shared/types';
import type { Step, TagBindProps } from '@/shared/types/step';

import { getStepClasses } from '../hooks/getStepClasses';
import { useAgentMenu } from '../hooks/useAgentMenu';

import { AgentPopover } from './AgentPopover';
import StepContent from './StepContent';
import TagGroupChipPicker from './TagGroupChipPicker';

interface OnboardingStepsProps extends TagBindProps {
  projectName: string;
  steps: Step[];
  completedSteps: string[];
  onStepAction: (stepId: string) => void;
  onStepComplete: (stepId: string) => void;
  onDismiss: () => void;
  agents?: AgentConfig[];
  selectedAgentId?: string | null;
  installedMap?: Map<string, boolean>;
  onSelectAgent?: (agent: AgentConfig) => void;
}

export function OnboardingSteps({
  projectName,
  steps,
  completedSteps,
  onStepAction,
  onStepComplete,
  onDismiss,
  agents = [],
  selectedAgentId = null,
  installedMap = new Map(),
  onSelectAgent,
  tagGroups = [],
  boundTagGroupIds = [],
  selectedTagGroupIds = [],
  tagGroupsLoading = false,
  tagBindingSaving = false,
  tagsExpanded = false,
  onTagsExpandedChange,
  onTagSelectionChange,
  onApplyTagBinding,
  onViewSkills,
}: OnboardingStepsProps) {
  const {
    open: agentMenuOpen,
    anchorRef: agentBtnRef,
    handleOpen: handleOpenAgentMenu,
    handleClose: handleCloseAgentMenu,
    handleSelect: handleSelectAgent,
  } = useAgentMenu({ onSelectAgent });
  const completedCount = completedSteps.length;
  const totalSteps = steps.length;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-base font-semibold text-text-primary">
            Get started with {projectName}
          </h3>
          <span className="text-[11px] text-text-muted">
            <strong className="text-text-primary">{completedCount}</strong> / {totalSteps}
          </span>
        </div>
        <p className="text-[var(--font-size)] text-text-secondary mb-5">
          Complete these steps to enable full AI capability · skip anytime
        </p>

        <div className="flex flex-col gap-2">
          {steps.map((step) => {
            const done = completedSteps.includes(step.id);

            if (step.type === 'agent') {
              const { cardClasses, checkClasses, chevronClasses } = getStepClasses({
                done,
                expanded: agentMenuOpen,
              });
              return (
                <div key={step.id} className={cardClasses}>
                  <div className="step-item flex items-start gap-3 p-3">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-start gap-3 bg-transparent border-none text-left cursor-pointer p-0"
                      onClick={() => {
                        if (selectedAgentId) {
                          onStepAction(step.id);
                        } else {
                          handleOpenAgentMenu();
                        }
                      }}
                    >
                      <StepContent
                        step={step}
                        done={done}
                        checkClasses={checkClasses}
                        onStepComplete={onStepComplete}
                        action={<div className="text-text-muted shrink-0 mt-0.5">{step.icon}</div>}
                      />
                    </button>
                    <button
                      ref={agentBtnRef}
                      type="button"
                      className="agent-dropdown-toggle flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 cursor-pointer text-text-muted shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenAgentMenu();
                      }}
                      title="Choose another agent"
                      aria-expanded={agentMenuOpen}
                      aria-haspopup="menu"
                    >
                      <ChevronDown size={12} className={chevronClasses} />
                    </button>
                  </div>
                </div>
              );
            }

            if (step.type === 'tag') {
              if (!onTagSelectionChange || !onApplyTagBinding) return null;

              const expanded = tagsExpanded;
              const { cardClasses, checkClasses, chevronClasses } = getStepClasses({
                done,
                expanded,
              });
              return (
                <div key={step.id} className={cardClasses} data-testid="onboarding-tags-step">
                  <button
                    type="button"
                    className="step-item flex items-start gap-3 p-3 w-full cursor-pointer bg-transparent border-none text-left"
                    onClick={() => {
                      onTagsExpandedChange?.(!expanded);
                    }}
                    aria-expanded={expanded}
                  >
                    <StepContent
                      step={step}
                      done={done}
                      checkClasses={checkClasses}
                      onStepComplete={onStepComplete}
                      action={
                        <div className="text-text-muted shrink-0 mt-0.5 flex flex-col items-center gap-1">
                          {step.icon}
                          <ChevronDown size={12} className={chevronClasses} />
                        </div>
                      }
                    />
                  </button>
                  {expanded && (
                    <div className="px-3 pb-3 pt-0 border-t border-border/40 mx-3 mb-1">
                      <div className="pt-2.5">
                        <TagGroupChipPicker
                          tagGroups={tagGroups}
                          selectedIds={selectedTagGroupIds}
                          boundIds={boundTagGroupIds}
                          loading={tagGroupsLoading}
                          saving={tagBindingSaving}
                          onChange={onTagSelectionChange}
                          onApply={onApplyTagBinding}
                          onViewInSkills={onViewSkills}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            const { cardClasses, checkClasses } = getStepClasses({ done });
            return (
              <div key={step.id} className={cardClasses}>
                <button
                  type="button"
                  className="step-item flex items-start gap-3 p-3 w-full cursor-pointer bg-transparent border-none text-left"
                  onClick={() => onStepAction(step.id)}
                >
                  <StepContent
                    step={step}
                    done={done}
                    checkClasses={checkClasses}
                    onStepComplete={onStepComplete}
                    action={<div className="text-text-muted shrink-0 mt-0.5">{step.icon}</div>}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end mt-4 pt-3 border-t border-border/50">
          <button
            type="button"
            className="text-[12px] text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer"
            onClick={onDismiss}
          >
            Hide for now
          </button>
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
