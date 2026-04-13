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
         className={`flex items-center gap-1 h-6 px-2 rounded-md border cursor-pointer min-w-0 ${isActive
               ? "border-accent-blue bg-accent-blue/10 text-accent-blue"
               : "border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
         onClick={handleClick}
         title={title}
      >
         {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-status-running shrink-0" />}
         <span className="text-xs truncate">{title}</span>
         <button
            className="tb-icon-btn w-4 h-4 rounded text-xs text-inherit hover:bg-bg-hover"
            onClick={handleClose}
            title="Close tab"
         >
            ×
         </button>
      </div>
   );
}

export default React.memo(TerminalTab);
