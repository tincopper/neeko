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
      (event: React.MouseEvent) => {
         event.stopPropagation();
         onClose(id);
      },
      [id, onClose]
   );

   return (
      <div
         className={`flex items-center gap-1 h-6 px-2 rounded-md cursor-pointer min-w-0 transition-colors ${isActive
               ? "bg-bg-hover text-text-primary"
               : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
         onClick={handleClick}
         title={title}
      >
         {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-status-running shrink-0" />}
         <span className="truncate" style={{ fontSize: "var(--terminal-font-size)" }}>{title}</span>
          <button
             className="tb-icon-btn w-4 h-4 rounded text-inherit hover:bg-bg-hover transition-colors flex items-center justify-center shrink-0 leading-none"
             style={{ fontSize: "var(--terminal-font-size)" }}
             onClick={handleClose}
             title="Close tab"
          >
             ×
          </button>
      </div>
   );
}

export default React.memo(TerminalTab);
