interface GetStepClassesOptions {
  done: boolean;
  expanded?: boolean;
}

interface GetStepClassesResult {
  cardClasses: string;
  checkClasses: string;
  chevronClasses: string;
}

const STEP_CARD_BASE = 'step-card rounded-xl border text-left bg-transparent';
const STEP_CARD_DONE = 'border-green-500/20 bg-green-500/[0.03]';
const STEP_CARD_DEFAULT = 'border-border bg-transparent';

const CHECK_BASE =
  'step-check w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200';
const CHECK_DONE = 'border-green-500 bg-green-500';
const CHECK_DEFAULT = 'border-border bg-bg-primary';

const CHEVRON_BASE = 'transition-transform duration-150';
const CHEVRON_EXPANDED = 'rotate-180 text-accent-blue';

export function getStepClasses({ done, expanded }: GetStepClassesOptions): GetStepClassesResult {
  const cardClasses = [STEP_CARD_BASE, done ? STEP_CARD_DONE : STEP_CARD_DEFAULT]
    .filter(Boolean)
    .join(' ');
  const checkClasses = [CHECK_BASE, done ? CHECK_DONE : CHECK_DEFAULT].filter(Boolean).join(' ');
  const chevronClasses = [CHEVRON_BASE, expanded && CHEVRON_EXPANDED].filter(Boolean).join(' ');

  return { cardClasses, checkClasses, chevronClasses };
}
