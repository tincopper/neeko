import React from "react";

interface PaneToolbarProps {
  visible: boolean;
  canSplit: boolean;
  paneCount: number;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClose: () => void;
}

interface ActionButtonProps {
  ariaLabel: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ActionButton({ ariaLabel, title, disabled, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-6 h-6 rounded flex items-center justify-center text-text-primary transition-colors bg-bg-secondary/90 hover:bg-bg-hover ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}

function PaneToolbar({
  visible,
  canSplit,
  paneCount,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
}: PaneToolbarProps) {
  return (
    <div
      className={`absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-border bg-bg-secondary/80 p-1 backdrop-blur-sm transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <ActionButton
        ariaLabel="Split Horizontal"
        title={canSplit ? "Split Horizontal" : "Maximum panes reached"}
        disabled={!canSplit}
        onClick={onSplitHorizontal}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
          <path d="M6 2V10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ActionButton>

      <ActionButton
        ariaLabel="Split Vertical"
        title={canSplit ? "Split Vertical" : "Maximum panes reached"}
        disabled={!canSplit}
        onClick={onSplitVertical}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
          <path d="M1 6H11" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ActionButton>

      {paneCount > 1 && (
        <ActionButton ariaLabel="Close Pane" title="Close Pane" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </ActionButton>
      )}
    </div>
  );
}

export default React.memo(PaneToolbar);
