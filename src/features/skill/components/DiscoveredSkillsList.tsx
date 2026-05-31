import React, { useCallback } from "react";
import { Download, X } from "@/shared/components/icons"
import { Button } from "@/ui";
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
          console.error("Import failed:", e);
        }
      },
      [onImport]
    );

    if (skills.length === 0) return null;

    return (
      <div className="px-4 py-2 border-b border-border bg-accent/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-accent">
            Discovered {skills.length} skill(s)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-5 w-5 p-0 text-text-muted hover:text-text-primary"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="space-y-1.5">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between p-2 rounded bg-bg-primary border border-border"
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium truncate">
                  {skill.name_guess || skill.found_path.split("/").pop()}
                </span>
                <span className="text-[10px] text-text-muted truncate">
                  {skill.tool} • {skill.found_path}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleImport(skill.found_path, skill.name_guess || undefined)
                }
                className="h-6 px-2 text-[10px] gap-1 ml-2 shrink-0"
              >
                <Download className="h-3 w-3" />
                Import
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  }
);

DiscoveredSkillsList.displayName = "DiscoveredSkillsList";

export default DiscoveredSkillsList;
