import React from "react";
import type { DiffMode } from '@/shared/types';
import { ToggleGroup, ToggleGroupItem } from "@/ui";

interface GitPanelProps {
  diffMode: DiffMode;
  onDiffModeChange: (diffMode: DiffMode) => void;
}

const GitPanel: React.FC<GitPanelProps> = ({ diffMode, onDiffModeChange }) => {
  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Git</h3>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Diff View Mode
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            How file diffs are displayed
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ToggleGroup
            type="single"
            value={diffMode}
            onValueChange={(value) => {
              if (value) onDiffModeChange(value as DiffMode);
            }}
          >
            <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
            <ToggleGroupItem value="split">Split</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </>
  );
};

export default React.memo(GitPanel);
