import React from 'react';

import { cn } from '@/lib/utils';

interface NavRowProps {
  active: boolean;
  onSelect: () => void;
  /** Leading visual: agent icon, project avatar, or tag grid icon. */
  leading?: React.ReactNode;
  /** Label (and rename input swap) plus trailing metrics — composed by the caller. */
  children: React.ReactNode;
  /** Hover-reveal row actions (rename/sync/delete). Switches to div+group/row mode. */
  actions?: React.ReactNode;
  /** Native button title (e.g. metrics tooltip). */
  title?: string;
  testId?: string;
  /** Row gap override. Skills project rows use wider gap. */
  gapClassName?: string;
}

const BASE_ROW_CLASSES =
  'flex items-center w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150';

/**
 * Navigation row skeleton shared by the Skills and MCP nav panels.
 * Button mode for plain rows; div mode (with hover-reveal actions) for tag rows
 * that embed nested buttons (button-in-button is invalid HTML).
 */
const NavRow: React.FC<NavRowProps> = ({
  active,
  onSelect,
  leading,
  children,
  actions,
  title,
  testId,
  gapClassName = 'gap-2',
}) => {
  const stateClasses = active
    ? 'bg-bg-selected text-text-primary'
    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary';

  if (actions) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'group/row cursor-pointer',
          BASE_ROW_CLASSES,
          gapClassName,
          'text-[var(--font-size)]',
          stateClasses,
        )}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {leading}
        {children}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity w-0 group-hover/row:w-auto overflow-hidden group-hover/row:overflow-visible">
          {actions}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(BASE_ROW_CLASSES, gapClassName, 'text-[var(--font-size)]', stateClasses)}
      title={title}
      data-testid={testId}
    >
      {leading}
      {children}
    </button>
  );
};

NavRow.displayName = 'NavRow';

export default NavRow;
