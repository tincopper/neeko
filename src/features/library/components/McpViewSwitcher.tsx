import { Download, Package } from 'lucide-react';
import React from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';

/** Installed / Marketplace view switcher for the MCP navigation panel. */
const McpViewSwitcher: React.FC = React.memo(() => {
  const mcpView = useMcpStore((s) => s.mcpView);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const mcpServers = useMcpStore((s) => s.mcpServers);

  return (
    <>
      <button
        type="button"
        className={cn(
          'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
          mcpView === 'installed'
            ? 'bg-bg-selected text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={() => setMcpView('installed')}
      >
        <Package className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate flex-1 font-medium">Installed</span>
        <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
          {mcpServers.length}
        </span>
      </button>
      <button
        type="button"
        className={cn(
          'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
          mcpView === 'marketplace'
            ? 'bg-bg-selected text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={() => setMcpView('marketplace')}
      >
        <Download className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="truncate flex-1 font-medium">Marketplace</span>
      </button>
    </>
  );
});

McpViewSwitcher.displayName = 'McpViewSwitcher';

export default McpViewSwitcher;
