import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PRListItem } from "../../types";
import { ChevronRightIcon } from "../icons";
import { cn } from "../../utils/cn";
import { GitPullRequest, GitMerge, GitFork, ExternalLink, X } from "lucide-react";

interface PullRequestsPanelProps {
  projectId: string;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onRefreshGit: (projectId: string) => void;
}

const STATE_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  all: "All",
};

const AUTO_SYNC_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "5m", value: 300_000 },
];

const PullRequestsPanel: React.FC<PullRequestsPanelProps> = ({
  projectId,
  onShowToast,
  onRefreshGit,
}) => {
  const [prList, setPrList] = useState<PRListItem[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("open");
  const [ghInstalled, setGhInstalled] = useState(false);
  const [autoSync, setAutoSync] = useState(0);
  const autoSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    invoke<boolean>("is_gh_installed_command")
      .then(setGhInstalled)
      .catch(() => setGhInstalled(false));
    // Restore persisted VCS settings
    invoke<{ auto_sync?: number; expanded?: boolean }>(
      "load_vcs_settings_command",
      { projectId }
    )
      .then((s) => {
        if (typeof s.auto_sync === "number") setAutoSync(s.auto_sync);
        if (typeof s.expanded === "boolean") setExpanded(s.expanded);
      })
      .catch(() => {});
  }, []);

  // Persist settings when they change
  useEffect(() => {
    invoke("save_vcs_settings_command", {
      projectId,
      settings: { auto_sync: autoSync, expanded },
    }).catch(() => {});
  }, [autoSync, expanded, projectId]);

  const loadPRs = useCallback(async () => {
    if (!ghInstalled) return;
    setLoading(true);
    try {
      const prs = await invoke<PRListItem[]>("list_prs_command", {
        projectId,
        state: filter,
        limit: 20,
      });
      setPrList(prs);
    } catch {
      // gh not authenticated or no remote
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, ghInstalled]);

  useEffect(() => {
    loadPRs();
  }, [loadPRs]);

  // Auto-sync interval (参考 Muxy VCSTabState PR auto-sync)
  useEffect(() => {
    if (autoSyncRef.current) {
      clearInterval(autoSyncRef.current);
      autoSyncRef.current = null;
    }
    if (autoSync > 0 && expanded) {
      autoSyncRef.current = setInterval(() => {
        loadPRs();
      }, autoSync);
    }
    return () => {
      if (autoSyncRef.current) {
        clearInterval(autoSyncRef.current);
        autoSyncRef.current = null;
      }
    };
  }, [autoSync, expanded, loadPRs]);

  const handleMerge = useCallback(
    async (number: number) => {
      setLoading(true);
      try {
        const result = await invoke<{ success: boolean; message: string }>(
          "merge_pr_command",
          { projectId, prNumber: number, method: "squash" }
        );
        onShowToast?.(result.message, "info");
        loadPRs();
        onRefreshGit(projectId);
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [projectId, loadPRs, onRefreshGit, onShowToast]
  );

  const handleClose = useCallback(
    async (number: number) => {
      setLoading(true);
      try {
        await invoke("close_pr_command", { projectId, prNumber: number });
        onShowToast?.("PR closed", "info");
        loadPRs();
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [projectId, loadPRs, onShowToast]
  );

  const handleOpenUrl = useCallback(
    async (number: number) => {
      try {
        const info = await invoke<{ url: string }>("view_pr_command", {
          projectId,
          prNumber: number,
        });
        window.open(info.url, "_blank");
      } catch {
        // ignore
      }
    },
    [projectId]
  );

  if (!ghInstalled) {
    return null;
  }

  return (
    <div className="flex flex-col shrink-0">
      <div className="flex items-center gap-1 px-3 py-1">
        <div
          className="flex items-center gap-1 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary select-none flex-1"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronRightIcon
            size={9}
            className={cn(
              "text-[0.6em] w-2.5 shrink-0 transition-transform duration-150",
              expanded && "rotate-90"
            )}
          />
          Pull Requests ({prList.length})
        </div>
        <select
          className="text-[10px] bg-transparent border-none text-text-muted cursor-pointer appearance-none px-1"
          value={autoSync}
          onChange={(e) => setAutoSync(Number(e.target.value))}
        >
          {AUTO_SYNC_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {expanded && (
        <>
          <div className="flex items-center gap-1 px-3 py-0.5">
            {(["open", "closed", "merged", "all"] as const).map((s) => (
              <button
                key={s}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors duration-100",
                  filter === s
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                )}
                onClick={() => setFilter(s)}
              >
                {STATE_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="max-h-[200px] overflow-y-auto">
            {loading && prList.length === 0 ? (
              <div className="p-3 text-center text-xs text-text-muted">Loading...</div>
            ) : prList.length === 0 ? (
              <div className="p-3 text-center text-xs text-text-muted">No pull requests</div>
            ) : (
              prList.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center gap-1.5 py-1 px-3 text-xs text-text-secondary hover:bg-bg-hover transition-colors duration-100 group cursor-pointer"
                  onClick={() => handleOpenUrl(pr.number)}
                >
                  {pr.is_cross_repository ? (
                    <span title="Cross-repository PR">
                      <GitFork
                        size={11}
                        className={cn(
                          "shrink-0",
                          pr.state === "OPEN" && "text-accent-green",
                          pr.state === "CLOSED" && "text-accent-red",
                          pr.state === "MERGED" && "text-[#a371f7]"
                        )}
                      />
                    </span>
                  ) : (
                    <GitPullRequest
                      size={11}
                      className={cn(
                        "shrink-0",
                        pr.state === "OPEN" && "text-accent-green",
                        pr.state === "CLOSED" && "text-accent-red",
                        pr.state === "MERGED" && "text-[#a371f7]"
                      )}
                    />
                  )}
                  <span className="flex-1 truncate">{pr.title}</span>
                  {pr.is_cross_repository && pr.head_repository_owner && (
                    <span
                      className="text-[9px] text-text-muted shrink-0 max-w-[60px] truncate"
                      title={`Fork from ${pr.head_repository_owner}`}
                    >
                      {pr.head_repository_owner}
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted shrink-0">
                    #{pr.number}
                  </span>
                  {pr.state === "OPEN" && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green"
                        title="Squash merge"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMerge(pr.number);
                        }}
                      >
                        <GitMerge size={11} />
                      </button>
                      <button
                        className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-red"
                        title="Close PR"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClose(pr.number);
                        }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <button
                    className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue opacity-0 group-hover:opacity-100"
                    title="Open in browser"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenUrl(pr.number);
                    }}
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(PullRequestsPanel);
