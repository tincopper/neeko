import { ChevronDown, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';

interface NavSectionProps {
  /** Uppercase section heading (Tags / Agents / Projects). */
  title: string;
  /** Initial collapsed state. Tags default open, Agents/Projects default closed. */
  defaultExpanded?: boolean;
  /** Header-right actions (e.g. New tag group +). Switches the header to title-button + actions layout. */
  actions?: React.ReactNode;
  /** List container classes. Tags use roomier bottom padding. */
  listClassName?: string;
  children: React.ReactNode;
}

/**
 * Collapsible navigation section shell shared by the Skills and MCP nav panels.
 * Owns only the expanded state; data, selection and CRUD stay per-feature.
 */
const NavSection: React.FC<NavSectionProps> = ({
  title,
  defaultExpanded = false,
  actions,
  listClassName = 'pb-1 px-1.5',
  children,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const chevron = expanded ? (
    <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
  ) : (
    <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
  );
  const label = (
    <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
      {title}
    </span>
  );

  return (
    <div className="border-t border-border mt-0.5 pt-1">
      {actions ? (
        <div className="flex items-center gap-1 px-3 py-1.5 select-none">
          <button
            type="button"
            className="flex items-center gap-1 flex-1 min-w-0 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            {chevron}
            {label}
          </button>
          {actions}
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
          onClick={() => setExpanded((v) => !v)}
        >
          {chevron}
          {label}
        </button>
      )}
      {expanded && <div className={listClassName}>{children}</div>}
    </div>
  );
};

NavSection.displayName = 'NavSection';

export default NavSection;
