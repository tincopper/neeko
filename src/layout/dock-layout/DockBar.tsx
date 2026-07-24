import React from 'react';

import { TooltipProvider } from '@/ui/tooltip';

interface DockBarProps {
  side: 'left' | 'right';
  buttons: React.ReactNode[];
}

const DockBar: React.FC<DockBarProps> = ({ side, buttons }) => {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex w-11 shrink-0 flex-col items-center py-2"
        role="toolbar"
        aria-label={`${side} toolbar`}
      >
        {buttons}
      </div>
    </TooltipProvider>
  );
};

export default React.memo(DockBar);
