import React, { useState, useCallback, useRef } from "react";
import { useAppStore } from "../../store/appStore";
import { useAppContext } from "../../contexts";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useGitLog } from "./useGitLog";
import { useCommitDetail } from "./useCommitDetail";
import LogToolbar from "./LogToolbar";
import CommitList from "./CommitList";
import CommitDetailPanel from "./CommitDetailPanel";
import type { CommitMenuAction } from "./types";

const MIN_LEFT_WIDTH = 300;
const MAX_LEFT_WIDTH_RATIO = 0.7;

const GitLogPanel: React.FC = () => {
  const { project, commands, capabilities } = useActiveProject();
  const { showToast } = useAppContext();

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(0.55); // ratio
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { commits, loading, hasMore, loadMore, refresh, loadingMore } =
    useGitLog(commands);

  const { detail, files, loading: detailLoading, error: detailError } = useCommitDetail(
    commands,
    selectedHash,
  );

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      dragRef.current = {
        startX: e.clientX,
        startWidth: leftWidth,
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current || !container) return;
        const containerWidth = container.offsetWidth;
        const delta = ev.clientX - dragRef.current.startX;
        const newRatio = dragRef.current.startWidth + delta / containerWidth;
        const minRatio = MIN_LEFT_WIDTH / containerWidth;
        const clamped = Math.max(minRatio, Math.min(MAX_LEFT_WIDTH_RATIO, newRatio));
        setLeftWidth(clamped);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [leftWidth],
  );

  const handleAction = useCallback(
    async (hash: string, action: CommitMenuAction, value?: string) => {
      if (!commands) return;
      try {
        switch (action) {
          case "cherry-pick":
            if (capabilities?.canCherryPick) {
              await commands.cherryPick(hash);
              showToast?.("Cherry-picked successfully", "info");
            }
            break;
          case "revert":
            if (capabilities?.canRevert) {
              await commands.revert(hash);
              showToast?.("Reverted successfully", "info");
            }
            break;
          case "checkout-detached":
            // checkout-detached is not available in ProjectCommands interface.
            // TODO: add checkoutDetached() to ProjectCommands if needed.
            showToast?.("Checkout detached HEAD is not supported for this project type", "error");
            break;
          case "create-branch":
            await commands.createBranch(value ?? "", hash);
            showToast?.(`Branch '${value}' created`, "info");
            break;
          case "create-tag":
            if (capabilities?.canCreateTag) {
              await commands.createTag(value ?? "");
              showToast?.(`Tag '${value}' created`, "info");
            }
            break;
        }
        refresh();
      } catch (e: unknown) {
        showToast?.(String(e), "error");
      }
    },
    [commands, capabilities, showToast, refresh],
  );

  const handleOpenDiff = useCallback(
    (filePath: string) => {
      if (!project || !selectedHash) return;
      // Commit diff tab is only supported for local projects.
      // For WSL/Remote, the DiffSource "commit" type does not have a variant
      // that carries wsl/remote connection params, so we skip opening the tab.
      if (project.type !== "local") return;

      const appStore = useAppStore.getState();
      const tabId = `diff_${selectedHash.slice(0, 7)}_${filePath.replace(/[/\\]/g, "_")}`;
      appStore.addTab(project.id, {
        id: tabId,
        projectId: project.id,
        title: filePath.split(/[/\\]/).pop() ?? filePath,
        order: 200,
        data: {
          kind: "diff",
          filePath,
          fileName: filePath.split(/[/\\]/).pop() ?? filePath,
          diffSource: {
            type: "commit",
            projectId: project.id,
            commitHash: selectedHash,
          },
        },
      });
      appStore.activateTab(project.id, tabId);
    },
    [project, selectedHash],
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        No project selected
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full p-1.5 gap-0.5">
      <LogToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={refresh}
        loading={loading}
      />

      <div className="flex-1 min-h-0 flex flex-row gap-0.5 overflow-hidden">
        {/* Left: Commit list with graph */}
        <div
          className="flex flex-col overflow-hidden bg-bg-tertiary/20 rounded-md"
          style={{ width: `${leftWidth * 100}%` }}
        >
          <CommitList
            commits={commits}
            selectedHash={selectedHash}
            onSelectCommit={setSelectedHash}
            onAction={handleAction}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            searchQuery={searchQuery}
          />
        </div>

        {/* Divider */}
        <div
          className="group w-1 shrink-0 cursor-col-resize flex items-center justify-center"
          onMouseDown={handleDividerMouseDown}
        >
          <div className="h-8 w-[3px] rounded-full bg-border group-hover:bg-accent-blue/50 transition-colors duration-150" />
        </div>

        {/* Right: Commit detail */}
        <div className="flex-1 min-w-0 overflow-hidden bg-bg-tertiary/20 rounded-md">
          <CommitDetailPanel
            detail={detail}
            files={files}
            loading={detailLoading}
            error={detailError}
            onOpenDiff={handleOpenDiff}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(GitLogPanel);
