import React from 'react';

import { cn } from '@/lib/utils';

interface CountLabelProps {
  loading: boolean;
  /** Any load error — renders the error glyph in red. */
  error?: unknown;
  count?: number;
  /** Value formatter (e.g. `${n}g` for bound tag groups). */
  format?: (n: number) => string;
  className?: string;
  testId?: string;
}

/**
 * Tri-state count label shared by the Skills and MCP nav panels.
 * Unifies the previously divergent glyphs (Skills `!`/`…` vs MCP `?`/`...`)
 * on the richer Skills variant: error glyph + red + tooltip at the call site.
 */
const CountLabel: React.FC<CountLabelProps> = ({
  loading,
  error,
  count,
  format = String,
  className,
  testId,
}) => {
  return (
    <span
      className={cn(
        'text-[11px] tabular-nums min-w-[1.25rem] text-right',
        error ? 'text-accent-red' : 'text-text-muted',
        className,
      )}
      data-testid={testId}
    >
      {error ? '!' : loading && count === undefined ? '…' : format(count ?? 0)}
    </span>
  );
};

CountLabel.displayName = 'CountLabel';

export default CountLabel;
