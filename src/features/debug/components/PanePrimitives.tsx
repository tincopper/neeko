import React from 'react';

import { cn } from '@/lib/utils';

/** Uppercase micro label above a debug pane section. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 h-6 flex items-center shrink-0 border-b border-border text-[10px] font-medium uppercase tracking-wide text-text-muted">
      {children}
    </div>
  );
}

/** Muted placeholder shown when a debug pane has nothing to render. */
export function EmptyHint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'px-3 py-3 text-[calc(var(--font-size)-1px)] text-text-muted leading-relaxed',
        className,
      )}
    >
      {children}
    </div>
  );
}
