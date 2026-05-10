import React, { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/appStore";
import { useAppContext } from "../../contexts";
import { useGitLog } from "./useGitLog";
import { useCommitDetail } from "./useCommitDetail";
import LogToolbar from "./LogToolbar";
import CommitList from "./CommitList";
import CommitDetailPanel from "./CommitDetailPanel";
import type { CommitMenuAction } from "./types";

const MIN_LEFT_WIDTH = 300;
const MAX_LEFT_WIDTH_RATIO = 0.7;

const GitLogPanel: React.FC = () => {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { showToast } = useAppContext();

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(0.55); // ratio
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { commits, loading, hasMore, loadMore, refresh, loadingMore } =
    useGitLog(activeProjectId);

  const { detail, files, loading: detailLoading, error: detailError } = useCommitDetail(
    activeProjectId,
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
      if (!activeProjectId) return;
      try {
        switch (action) {
          case "cherry-pick":
            await invoke("cherry_pick_command", { projectId: activeProjectId, commitHash: hash });
            showToast?.("Cherry-picked successfully", "info");
            break;
          case "revert":
            await invoke("revert_command", { projectId: activeProjectId, commitHash: hash });
            showToast?.("Reverted successfully", "info");
            break;
          case "checkout-detached":
            await invoke("checkout_detached_command", {
              projectId: activeProjectId,
              commitHash: hash,
            });
            showToast?.("Checked out detached HEAD", "info");
            break;
          case "create-branch":
            await invoke("create_branch", {
              projectId: activeProjectId,
              branchName: value,
              startPoint: hash,
            });
            showToast?.(`Branch '${value}' created`, "info");
            break;
          case "create-tag":
            await invoke("create_tag_command", {
              projectId: activeProjectId,
              tagName: value,
              message: null,
            });
            showToast?.(`Tag '${value}' created`, "info");
            break;
        }
        refresh();
      } catch (e: unknown) {
        showToast?.(String(e), "error");
      }
    },
    [activeProjectId, showToast, refresh],
  );

  const handleOpenDiff = useCallback(
    (filePath: string) => {
      if (!activeProjectId || !selectedHash) return;
      const appStore = useAppStore.getState();
      const tabId = `diff_${selectedHash.slice(0, 7)}_${filePath.replace(/[/\\]/g, "_")}`;
      appStore.addTab(activeProjectId, {
        id: tabId,
        projectId: activeProjectId,
        title: filePath.split(/[/\\]/).pop() ?? filePath,
        order: 200,
        data: {
          kind: "diff",
          filePath,
          fileName: filePath.split(/[/\\]/).pop() ?? filePath,
          diffSource: {
            type: "commit",
            projectId: activeProjectId,
            commitHash: selectedHash,
          },
        },
      });
      appStore.activateTab(activeProjectId, tabId);
    },
    [activeProjectId, selectedHash],
  );

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-text-muted">
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
