import { Check } from 'lucide-react';

import type { Step } from '@/shared/types/step';

interface StepContentProps {
  step: Step;
  done: boolean;
  checkClasses: string;
  onStepComplete: (stepId: string) => void;
  action?: React.ReactNode;
}

export default function StepContent({
  step,
  done,
  checkClasses,
  onStepComplete,
  action,
}: StepContentProps) {
  return (
    <>
      <div className={checkClasses}>
        {done && <Check size={12} className="text-white" strokeWidth={3} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[var(--font-size)] font-medium text-text-primary">
            {step.title}
          </span>
          {step.recommended && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-accent-blue bg-accent-blue/8 px-1.5 py-0.5 rounded-full">
              Recommended
            </span>
          )}
        </div>
        <p className="text-[12px] text-text-muted mt-0.5">{step.description}</p>
        {!done && (
          <button
            type="button"
            className="text-[12px] text-accent-blue mt-1.5 bg-transparent border-none cursor-pointer font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onStepComplete(step.id);
            }}
          >
            Mark as done
          </button>
        )}
      </div>
      {action}
    </>
  );
}
