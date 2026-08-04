import { Blocks, MessageSquare, Server } from 'lucide-react';
import React from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';

interface ActivityItem {
  key: 'skill' | 'prompt' | 'mcp';
  label: string;
  icon: React.ElementType;
}

const ITEMS: ActivityItem[] = [
  { key: 'skill', label: 'Skills', icon: Blocks },
  { key: 'prompt', label: 'Prompts', icon: MessageSquare },
  { key: 'mcp', label: 'MCP', icon: Server },
];

const LibraryActivityBar: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  const setActiveKind = useLibraryStore((s) => s.setActiveKind);
  const promptCount = useLibraryStore((s) => s.prompts.length);
  const mcpCount = useLibraryStore((s) => s.mcpServers.length);
  const skillCount = useSkillStore((s) => s.skills.length);

  const counts: Record<string, number> = {
    skill: skillCount,
    prompt: promptCount,
    mcp: mcpCount,
  };

  return (
    <div className="flex flex-col gap-0.5 p-2 border-b border-border">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeKind === item.key;
        const count = counts[item.key];
        return (
          <button
            key={item.key}
            type="button"
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors w-full',
              isActive
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
            )}
            onClick={() => setActiveKind(item.key)}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-[11px] font-medium truncate">{item.label}</span>
            {count > 0 && (
              <span
                className={cn(
                  'text-[10px] tabular-nums px-1.5 py-0.5 rounded-md shrink-0 font-medium',
                  isActive ? 'text-text-primary bg-bg-hover' : 'text-text-muted bg-bg-hover',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});

LibraryActivityBar.displayName = 'LibraryActivityBar';

export default LibraryActivityBar;
