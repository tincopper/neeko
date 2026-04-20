import React, { useState, useCallback } from "react";
import type { DiffMode } from "../../types";
import type { GitSource } from "./GitBranchPanel";
import GitBranchPanel from "./GitBranchPanel";
import GitCommitView from "./GitCommitView";

interface GitWindowProps {
  gitSource: GitSource;
  currentBranch: string;
  diffMode: DiffMode;
}

type GitTab = "commit" | "log";

function GitWindow({ gitSource, currentBranch, diffMode }: GitWindowProps) {
  const [activeTab, setActiveTab] = useState<GitTab>("commit");

  const handleSwitchTab = useCallback((tab: GitTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-2 border-b border-border bg-bg-secondary shrink-0">
        <button
          className={`px-3 py-1.5 text-[calc(var(--font-size)-1px)] font-medium transition-colors border-b-2 ${
            activeTab === "commit"
              ? "border-accent-blue text-accent-blue"
              : "border-transparent text-text-muted hover:text-text-secondary"
          }`}
          onClick={() => handleSwitchTab("commit")}
        >
          Commit
        </button>
        <button
          className={`px-3 py-1.5 text-[calc(var(--font-size)-1px)] font-medium transition-colors border-b-2 ${
            activeTab === "log"
              ? "border-accent-blue text-accent-blue"
              : "border-transparent text-text-muted hover:text-text-secondary"
          }`}
          onClick={() => handleSwitchTab("log")}
        >
          Log
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "commit" ? (
          <GitCommitView
            gitSource={gitSource}
            currentBranch={currentBranch}
          />
        ) : (
          <GitBranchPanel
            gitSource={gitSource}
            currentBranch={currentBranch}
            diffMode={diffMode}
          />
        )}
      </div>
    </div>
  );
}

export default React.memo(GitWindow);
