import React, { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitEntry } from "../../types";
import { cn } from "../../utils/cn";
import { ChevronRightIcon } from "../icons";
import { Copy, GitCommitHorizontal, MoreHorizontal, GitBranchPlus, Tag, Undo2, GitFork, SquareArrowOutUpRight, Check } from "lucide-react";

interface CommitHistoryProps {
  projectId: string;
  commits: CommitEntry[];
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onRefreshGit: () => void;
}

type MenuAction = "idle" | "cherry-pick" | "revert" | "checkout-detached" | "create-branch" | "create-tag";

const CommitHistory: React.FC<CommitHistoryProps> = ({
  projectId,
  commits,
  expanded,
  onToggle,
  loading,
  onShowToast,
  onRefreshGit,
}) => {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ hash: string; action: MenuAction } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleAction = useCallback(
    async (hash: string, action: MenuAction) => {
      setMenuOpen(null);

      if (action === "create-branch" || action === "create-tag") {
        setActionState({ hash, action });
        setInputValue("");
        return;
      }

      setActionLoading(true);
      try {
        switch (action) {
          case "cherry-pick":
            await invoke("cherry_pick_command", { projectId, commitHash: hash });
            onShowToast?.("Cherry-picked successfully", "info");
            break;
          case "revert":
            await invoke("revert_command", { projectId, commitHash: hash });
            onShowToast?.("Reverted successfully", "info");
            break;
          case "checkout-detached":
            await invoke("checkout_detached_command", { projectId, commitHash: hash });
            onShowToast?.("Checked out detached HEAD", "info");
            break;
        }
        onRefreshGit();
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setActionLoading(false);
      }
    },
    [projectId, onShowToast, onRefreshGit]
  );

  const handleInputConfirm = useCallback(async () => {
    if (!actionState || !inputValue.trim()) return;

    setActionLoading(true);
    try {
      switch (actionState.action) {
        case "create-branch":
          await invoke("create_branch", {
            projectId,
            branchName: inputValue.trim(),
            startPoint: actionState.hash,
          });
          onShowToast?.(`Branch '${inputValue.trim()}' created`, "info");
          break;
        case "create-tag":
          await invoke("create_tag_command", {
            projectId,
            tagName: inputValue.trim(),
            message: null,
          });
          onShowToast?.(`Tag '${inputValue.trim()}' created`, "info");
          break;
      }
      onRefreshGit();
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setActionLoading(false);
      setActionState(null);
      setInputValue("");
    }
  }, [actionState, inputValue, projectId, onShowToast, onRefreshGit]);

  return (
    <div className="flex flex-col shrink-0">
      <div
        className="flex items-center gap-1 px-3 py-1 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary select-none shrink-0"
        onClick={onToggle}
      >
        <ChevronRightIcon
          size={9}
          className={cn(
            "text-[0.6em] w-2.5 shrink-0 transition-transform duration-150",
            expanded && "rotate-90"
          )}
        />
        Commits ({commits.length})
      </div>

      {expanded && (
        <div className="overflow-y-auto max-h-[240px]">
          {loading && commits.length === 0 ? (
            <div className="p-3 text-center text-xs text-text-muted">Loading...</div>
          ) : commits.length === 0 ? (
            <div className="p-3 text-center text-xs text-text-muted">No commits yet</div>
          ) : (
            commits.map((commit) => (
              <div key={commit.hash}>
                <div
                  className="flex items-start gap-2 py-1.5 px-3 text-xs text-text-secondary hover:bg-bg-hover transition-colors duration-100 group"
                >
                  <span className="flex items-center gap-1 shrink-0 mt-px">
                    <GitCommitHorizontal size={11} className="text-text-muted shrink-0" />
                    <span className="text-[10px] font-mono text-accent-blue">{commit.short_hash}</span>
                  </span>

                  <div className="flex-1 min-w-0">
                    <span className="truncate block text-text-primary leading-snug">
                      {commit.message}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {commit.author} &middot; {formatTimestamp(commit.timestamp)}
                      {commit.refs && (
                        <span className="ml-1 text-[9px] text-accent-orange">{refsLabel(commit.refs)}</span>
                      )}
                    </span>
                  </div>

                  <button
                    className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 opacity-0 group-hover:opacity-100 shrink-0"
                    title="Copy hash"
                    onClick={() => navigator.clipboard.writeText(commit.hash)}
                  >
                    <Copy size={11} />
                  </button>

                  <button
                    className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 opacity-0 group-hover:opacity-100 shrink-0"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(menuOpen === commit.hash ? null : commit.hash);
                    }}
                  >
                    <MoreHorizontal size={11} />
                  </button>
                </div>

                {/* Operation menu popover */}
                {menuOpen === commit.hash && (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-6 z-50 w-36 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5"
                  >
                    {!actionLoading && (
                      <>
                        <MenuItem icon={<GitFork size={11} />} label="Cherry Pick" onClick={() => handleAction(commit.hash, "cherry-pick")} />
                        <MenuItem icon={<Undo2 size={11} />} label="Revert" onClick={() => handleAction(commit.hash, "revert")} />
                        <MenuItem icon={<GitBranchPlus size={11} />} label="Create Branch" onClick={() => handleAction(commit.hash, "create-branch")} />
                        <MenuItem icon={<Tag size={11} />} label="Create Tag" onClick={() => handleAction(commit.hash, "create-tag")} />
                        <MenuItem icon={<SquareArrowOutUpRight size={11} />} label="Checkout Detached" onClick={() => handleAction(commit.hash, "checkout-detached")} />
                      </>
                    )}
                  </div>
                )}

                {/* Inline input for create branch / create tag */}
                {actionState?.hash === commit.hash && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary mx-3 rounded mb-0.5">
                    <span className="text-[10px] text-text-muted shrink-0">
                      {actionState.action === "create-branch" ? "Branch:" : "Tag:"}
                    </span>
                    <input
                      type="text"
                      className="flex-1 bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                      placeholder={actionState.action === "create-branch" ? "branch-name" : "v1.0.0"}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInputConfirm();
                        if (e.key === "Escape") {
                          setActionState(null);
                          setInputValue("");
                        }
                      }}
                      autoFocus
                      disabled={actionLoading}
                    />
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-green hover:bg-bg-hover transition-colors duration-100"
                      onClick={handleInputConfirm}
                      disabled={!inputValue.trim() || actionLoading}
                      title="Confirm"
                    >
                      <Check size={11} />
                    </button>
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100 text-[10px]"
                      onClick={() => {
                        setActionState(null);
                        setInputValue("");
                      }}
                      title="Cancel"
                    >
                      ESC
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
      onClick={onClick}
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function refsLabel(refs: string): string {
  const parts = refs.split(",").map((r) => r.trim()).filter(Boolean);
  const tags = parts.filter((r) => r.startsWith("tag:"));
  if (tags.length > 0) return `(${tags.map((t) => t.replace("tag: ", "")).join(", ")})`;
  const branches = parts.filter(
    (r) => !r.startsWith("tag:") && !r.startsWith("HEAD ->")
  );
  if (branches.length > 0) return `(${branches[0]})`;
  return "";
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return ts;
  }
}

export default React.memo(CommitHistory);
