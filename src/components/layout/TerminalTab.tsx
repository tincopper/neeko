import React, { useCallback } from "react";

interface TerminalTabProps {
  id: string;
  title: string;
  isActive: boolean;
  isRunning: boolean;
  onClose: (id: string) => void;
  onActivate: (id: string) => void;
}

function TerminalTab({
  id,
  title,
  isActive,
  isRunning,
  onClose,
  onActivate,
}: TerminalTabProps) {
  const handleClick = useCallback(() => {
    onActivate(id);
  }, [id, onActivate]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(id);
    },
    [id, onClose]
  );

  return (
    <div
      className={`terminal-tab ${isActive ? "active" : ""}`}
      onClick={handleClick}
      title={title}
    >
      {isRunning && <span className="terminal-tab-status" />}
      <span className="terminal-tab-title">{title}</span>
      <button
        className="terminal-tab-close"
        onClick={handleClose}
        title="Close tab"
      >
        ×
      </button>
    </div>
  );
}

export default React.memo(TerminalTab);