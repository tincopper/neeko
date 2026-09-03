import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Island shell class (layout-framework single source).
 * Every floating panel surface (dock zones, center views, editor groups,
 * debug/task consoles, Library nav/detail) is this exact set — flex-column
 * fill, rounded, subtle shadow, secondary surface. Sizing (`flex-1` / `h-full`
 * / fixed height) and positioning (`relative`) stay per call site.
 */
export const ISLAND_CLASS =
  'flex flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary min-h-0';

export interface IslandProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Floating island panel. Fill with content only — never re-declare the shell.
 */
const Island = React.forwardRef<HTMLDivElement, IslandProps>(function Island(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn(ISLAND_CLASS, className)} {...props} />;
});

export { Island };
