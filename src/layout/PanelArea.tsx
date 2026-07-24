import React from 'react';

import { useSidebar } from '@/shared/contexts/SidebarContext';
import { Sidebar } from '@/ui/sidebar';

interface PanelAreaProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Legacy panel area — no longer rendered by AppLayout after Phase 3 migration.
 * Kept for backward compatibility; now uses fixed 280px width.
 */
function PanelArea({ children, className }: PanelAreaProps) {
  const { activePanel } = useSidebar();

  if (activePanel === null) return null;

  return (
    <Sidebar variant="panel" className={className} style={{ width: 280 }}>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </Sidebar>
  );
}

export default React.memo(PanelArea);
