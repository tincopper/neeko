import React, { useCallback } from 'react';
import { Download, X } from '@/shared/components/icons';
import { Button } from '@/ui';
import type { DiscoveredSkillDto } from '@/shared/types';

interface DiscoveredSkillsListProps {
  skills: DiscoveredSkillDto[];
  onImport: (path: string, name?: string) => Promise<void>;
  onClear: () => void;
}

const DiscoveredSkillsList: React.FC<DiscoveredSkillsListProps> = React.memo(
  ({ skills, onImport, onClear }) => {
    const handleImport = useCallback(
      async (path: string, name?: string) => {
        try {
          await onImport(path, name);
        } catch (e) {
          console.error('Import failed:', e);
        }
      },
      [onImport],
    );

    if (skills.length === 0) return null;

    return (
      <div className="border-b border-border bg-accent/5 shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-accent">
            Discovered · {skills.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-5 w-5 p-0 text-text-muted hover:text-text-primary"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="pb-1.5">
          {skills.map(skill => (
            <div
              key={skill.id}
              className="flex items-center gap-2 pl-3 pr-2 py-1.5 mx-1.5 rounded-md hover:bg-bg-hover/80"
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
                  {skill.name_guess || skill.found_path.split('/').pop()}
                </span>
                <span className="text-[0.85em] text-text-muted truncate font-mono">
                  {skill.tool} · {skill.found_path}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void handleImport(skill.found_path, skill.name_guess || undefined)
                }
                className="h-6 px-2 text-[11px] gap-1 shrink-0 text-text-secondary hover:text-accent"
              >
                <Download className="h-3 w-3" />
                Import
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

DiscoveredSkillsList.displayName = 'DiscoveredSkillsList';

export default DiscoveredSkillsList;
