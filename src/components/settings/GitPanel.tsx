import React from "react";
import type { DiffMode } from "../../types";
import { cn } from "../../utils/cn";

interface GitPanelProps {
  diffMode: DiffMode;
  onDiffModeChange: (diffMode: DiffMode) => void;
}

const GitPanel: React.FC<GitPanelProps> = ({ diffMode, onDiffModeChange }) => {
  return (
    <>
      <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">
        Git
      </div>
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
          <div className="flex bg-bg-tertiary border border-border rounded-md overflow-hidden">
            <button
              className={cn(
                "py-1 px-3.5 bg-none border-none text-text-secondary text-[0.86em] cursor-pointer transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border",
                diffMode === "unified" && "!bg-accent-blue !text-white",
              )}
              onClick={() => onDiffModeChange("unified")}
            >
              Unified
            </button>
            <button
              className={cn(
                "py-1 px-3.5 bg-none border-none text-text-secondary text-[0.86em] cursor-pointer transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary",
                diffMode === "split" && "!bg-accent-blue !text-white",
              )}
              onClick={() => onDiffModeChange("split")}
            >
              Split
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(GitPanel);
