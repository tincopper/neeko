import React from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Pause,
  Redo2,
  Square,
  StepForward,
} from '@/shared/components/icons';
import { cn } from '@/shared/utils/cn';

export type DebugToolbarAction =
  | 'continue'
  | 'next'
  | 'stepIn'
  | 'stepOut'
  | 'pause'
  | 'stop';

interface DebugToolbarProps {
  isStopped: boolean;
  isRunning: boolean;
  onAction: (action: DebugToolbarAction) => void;
  /** denser for title bar */
  size?: 'sm' | 'md';
  className?: string;
  showStop?: boolean;
  /** Flat JetBrains-style strip (no outer chrome) */
  variant?: 'chip' | 'flat';
}

function ToolBtn({
  title,
  onClick,
  disabled,
  danger,
  accent,
  size,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: 'green' | 'yellow' | 'red' | 'blue';
  size: 'sm' | 'md';
  children: React.ReactNode;
}) {
  const dim = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded transition-colors duration-100 cursor-pointer',
        'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        dim,
        danger
          ? 'text-accent-red hover:bg-accent-red/12'
          : accent === 'green'
            ? 'text-accent-green hover:bg-accent-green/12'
            : accent === 'yellow'
              ? 'text-accent-yellow hover:bg-accent-yellow/12'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Debug action strip — JetBrains-like flat icon row.
 * Used in panel header and title bar.
 */
function DebugToolbar({
  isStopped,
  isRunning,
  onAction,
  size = 'md',
  className,
  showStop = false,
  variant = 'flat',
}: DebugToolbarProps) {
  const icon = size === 'sm' ? 14 : 15;
  const active = isStopped || isRunning;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 shrink-0',
        variant === 'chip' &&
          'rounded-md border border-border bg-bg-tertiary/60 px-0.5',
        className,
      )}
      role="toolbar"
      aria-label="Debug actions"
    >
      <ToolBtn
        title="Continue (F5)"
        size={size}
        accent="green"
        disabled={!isStopped}
        onClick={() => onAction('continue')}
      >
        <StepForward size={icon} strokeWidth={2} />
      </ToolBtn>
      <ToolBtn
        title="Pause"
        size={size}
        accent="yellow"
        disabled={!isRunning || isStopped}
        onClick={() => onAction('pause')}
      >
        <Pause size={icon} fill="currentColor" strokeWidth={0} />
      </ToolBtn>
      {showStop && (
        <ToolBtn
          title="Stop"
          size={size}
          danger
          disabled={!active}
          onClick={() => onAction('stop')}
        >
          <Square size={icon - 2} fill="currentColor" strokeWidth={0} />
        </ToolBtn>
      )}
      <div className="w-px h-3.5 bg-border/80 mx-1" />
      <ToolBtn
        title="Step Over"
        size={size}
        disabled={!isStopped}
        onClick={() => onAction('next')}
      >
        <Redo2 size={icon} strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        title="Step Into"
        size={size}
        disabled={!isStopped}
        onClick={() => onAction('stepIn')}
      >
        <ArrowDownToLine size={icon} strokeWidth={1.75} />
      </ToolBtn>
      <ToolBtn
        title="Step Out"
        size={size}
        disabled={!isStopped}
        onClick={() => onAction('stepOut')}
      >
        <ArrowUpFromLine size={icon} strokeWidth={1.75} />
      </ToolBtn>
    </div>
  );
}

export default React.memo(DebugToolbar);
