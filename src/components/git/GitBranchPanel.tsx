import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BranchGroup, CommitInfo, CommitDetail, AuthMethod } from "../../types";
import BranchList from "./BranchList";
import CommitLog from "./CommitLog";
import CommitDetailPanel from "./CommitDetail";
import CommitDiffView from "./CommitDiffView";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export type GitSource =
  | { type: "local"; projectId: string }
  | { type: "wsl"; distro: string; projectPath: string }
  | { type: "remote"; entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string };

interface GitBranchPanelProps {
  gitSource: GitSource;
  currentBranch: string;
  diffMode: "unified" | "split";
}

function GitBranchPanel({ gitSource, currentBranch, diffMode: initialDiffMode }: GitBranchPanelProps) {
  // Diff mode state (managed internally, initialized from config prop)
  const [diffMode, setDiffMode] = useState<"unified" | "split">(initialDiffMode);
  const handleToggleDiffMode = useCallback(() => {
    setDiffMode((prev) => (prev === "unified" ? "split" : "unified"));
  }, []);

  // Branch state
  const [branches, setBranches] = useState<BranchGroup | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // Commit log state
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  // Commit detail state
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // New branch dialog state
  const [newBranchDialog, setNewBranchDialog] = useState<{ sourceBranch: string } | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchError, setNewBranchError] = useState<string | null>(null);
  const [newBranchSubmitting, setNewBranchSubmitting] = useState(false);

  const PAGE_SIZE = 50;

  // Derive source-specific params
  const wslParams = useMemo(() => {
    if (gitSource.type === "wsl") {
      return { distro: gitSource.distro, projectPath: gitSource.projectPath };
    }
    return null;
  }, [gitSource]);

  const remoteParams = useMemo(() => {
    if (gitSource.type === "remote") {
      return {
        host: gitSource.host,
        port: gitSource.port,
        username: gitSource.username,
        auth: gitSource.auth,
        projectPath: gitSource.projectPath,
      };
    }
    return null;
  }, [gitSource]);

  // ─── Data Loading (source-aware) ─────────────────────────────────

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      let result: BranchGroup;
      if (gitSource.type === "wsl" && wslParams) {
        result = await invoke<BranchGroup>("wsl_get_all_branches", wslParams);
      } else if (gitSource.type === "remote" && remoteParams) {
        result = await invoke<BranchGroup>("remote_get_all_branches", remoteParams);
      } else {
        result = await invoke<BranchGroup>("get_all_branches", { projectId: (gitSource as { type: "local"; projectId: string }).projectId });
      }
      setBranches(result);
    } catch (err) {
      console.error("[GitBranchPanel] Failed to load branches:", err);
    } finally {
      setBranchesLoading(false);
    }
  }, [gitSource, wslParams, remoteParams]);

  const loadCommits = useCallback(async (reset = false) => {
    setCommitsLoading(true);
    try {
      const currentOffset = reset ? 0 : offset;
      let result: CommitInfo[];
      if (gitSource.type === "wsl" && wslParams) {
        result = await invoke<CommitInfo[]>("wsl_get_commit_log", { ...wslParams, offset: currentOffset, limit: PAGE_SIZE });
      } else if (gitSource.type === "remote" && remoteParams) {
        result = await invoke<CommitInfo[]>("remote_get_commit_log", { ...remoteParams, offset: currentOffset, limit: PAGE_SIZE });
      } else {
        result = await invoke<CommitInfo[]>("get_commit_log", {
          projectId: (gitSource as { type: "local"; projectId: string }).projectId,
          offset: currentOffset,
          limit: PAGE_SIZE,
        });
      }
      if (reset) {
        setCommits(result);
        setOffset(result.length);
      } else {
        setCommits((prev) => [...prev, ...result]);
        setOffset((prev) => prev + result.length);
      }
      setHasMore(result.length === PAGE_SIZE);
    } catch (err) {
      console.error("[GitBranchPanel] Failed to load commits:", err);
    } finally {
      setCommitsLoading(false);
    }
  }, [gitSource, wslParams, remoteParams, offset]);

  const loadCommitDetail = useCallback(async (hash: string) => {
    setDetailLoading(true);
    setSelectedFile(null);
    try {
      let result: CommitDetail;
      if (gitSource.type === "wsl" && wslParams) {
        result = await invoke<CommitDetail>("wsl_get_commit_detail", { ...wslParams, commitHash: hash });
      } else if (gitSource.type === "remote" && remoteParams) {
        result = await invoke<CommitDetail>("remote_get_commit_detail", { ...remoteParams, commitHash: hash });
      } else {
        result = await invoke<CommitDetail>("get_commit_detail", {
          projectId: (gitSource as { type: "local"; projectId: string }).projectId,
          commitHash: hash,
        });
      }
      setCommitDetail(result);
      if (result.files.length > 0) {
        setSelectedFile(result.files[0].path.toString());
      }
    } catch (err) {
      console.error("[GitBranchPanel] Failed to load commit detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, [gitSource, wslParams, remoteParams]);

  // ─── Effects ──────────────────────────────────────────────────────

  const sourceKey = gitSource.type === "local"
    ? gitSource.projectId
    : gitSource.type === "wsl"
      ? `wsl:${gitSource.distro}:${gitSource.projectPath}`
      : `remote:${gitSource.entryId}:${gitSource.projectPath}`;

  useEffect(() => {
    setCommits([]);
    setOffset(0);
    setSelectedHash(null);
    setCommitDetail(null);
    setSelectedFile(null);
    setSelectedBranch(null);
    loadBranches();
    loadCommits(true);
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleSelectBranch = useCallback((branch: string) => {
    setSelectedBranch(branch);
  }, []);

  const handleSelectCommit = useCallback((hash: string) => {
    setSelectedHash(hash);
    loadCommitDetail(hash);
  }, [loadCommitDetail]);

  const handleLoadMore = useCallback(() => {
    loadCommits(false);
  }, [loadCommits]);

  const handleRefresh = useCallback(() => {
    loadBranches();
    setOffset(0);
    loadCommits(true);
  }, [loadBranches, loadCommits]);

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
  }, []);

  const handleNewBranch = useCallback(() => {
    setNewBranchDialog({ sourceBranch: currentBranch });
    setNewBranchName("");
    setNewBranchError(null);
  }, [currentBranch]);

  const handleNewBranchFrom = useCallback((sourceBranch: string) => {
    setNewBranchDialog({ sourceBranch });
    setNewBranchName("");
    setNewBranchError(null);
  }, []);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim() || !newBranchDialog) return;
    setNewBranchSubmitting(true);
    setNewBranchError(null);
    try {
      if (gitSource.type === "wsl" && wslParams) {
        await invoke("wsl_create_branch", { ...wslParams, branchName: newBranchName.trim() });
      } else if (gitSource.type === "remote") {
        setNewBranchError("SSH branch creation not yet supported");
        setNewBranchSubmitting(false);
        return;
      } else {
        await invoke("create_branch", { projectId: (gitSource as { type: "local"; projectId: string }).projectId, branchName: newBranchName.trim() });
      }
      setNewBranchDialog(null);
      handleRefresh();
    } catch (err) {
      setNewBranchError(String(err));
    } finally {
      setNewBranchSubmitting(false);
    }
  }, [newBranchName, newBranchDialog, gitSource, wslParams, handleRefresh]);

  const handleCloseNewBranchDialog = useCallback(() => {
    setNewBranchDialog(null);
  }, []);

  const handleCheckout = useCallback(async (branch: string) => {
    try {
      if (gitSource.type === "wsl" && wslParams) {
        await invoke("wsl_checkout_branch", { ...wslParams, branchName: branch });
      } else if (gitSource.type === "remote" && remoteParams) {
        await invoke("remote_checkout_branch", { ...remoteParams, branchName: branch });
      } else {
        await invoke("checkout_branch", { projectId: (gitSource as { type: "local"; projectId: string }).projectId, branchName: branch });
      }
      handleRefresh();
    } catch (err) {
      console.error("[GitBranchPanel] Checkout failed:", err);
    }
  }, [gitSource, wslParams, remoteParams, handleRefresh]);

  const handleDeleteBranch = useCallback(async (branch: string) => {
    if (!window.confirm(`Delete branch "${branch}"?`)) return;
    try {
      if (gitSource.type === "local") {
        await invoke("delete_branch", { projectId: gitSource.projectId, branchName: branch });
      }
      // WSL/Remote: delete_branch not yet available
      handleRefresh();
    } catch (err) {
      console.error("[GitBranchPanel] Delete branch failed:", err);
    }
  }, [gitSource, handleRefresh]);

  const handleRenameBranch = useCallback(async (oldName: string, newName: string) => {
    try {
      if (gitSource.type === "wsl" && wslParams) {
        await invoke("wsl_rename_branch", { ...wslParams, oldName, newName });
      } else if (gitSource.type === "remote" && remoteParams) {
        await invoke("remote_rename_branch", { ...remoteParams, oldName, newName });
      } else {
        await invoke("rename_branch", { projectId: (gitSource as { type: "local"; projectId: string }).projectId, oldName, newName });
      }
      handleRefresh();
    } catch (err) {
      console.error("[GitBranchPanel] Rename branch failed:", err);
    }
  }, [gitSource, wslParams, remoteParams, handleRefresh]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return (
    <div className="flex h-full w-full">
      {/* Left: Branch list (200px) */}
      <div className="w-[200px] shrink-0">
        <BranchList
          branches={branches}
          loading={branchesLoading}
          selectedBranch={selectedBranch}
          onSelectBranch={handleSelectBranch}
          onRefresh={handleRefresh}
          onNewBranch={handleNewBranch}
          onCheckout={handleCheckout}
          onDeleteBranch={handleDeleteBranch}
          onRenameBranch={handleRenameBranch}
          onNewBranchFrom={handleNewBranchFrom}
          currentBranch={currentBranch}
        />
      </div>

      {/* Middle: Commit log (flex-1) */}
      <div className="flex-1 min-w-0">
        <CommitLog
          commits={commits}
          selectedHash={selectedHash}
          loading={commitsLoading}
          searchQuery={searchQuery}
          selectedBranch={selectedBranch}
          onSearchChange={handleSearchChange}
          onSelectCommit={handleSelectCommit}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
        />
      </div>

      {/* Right: Commit detail + diff (350px) */}
      <div className="w-[350px] shrink-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          <CommitDetailPanel
            detail={commitDetail}
            loading={detailLoading}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            diffMode={diffMode}
            onToggleDiffMode={handleToggleDiffMode}
          />
        </div>
        {/* Diff view for selected file (local projects only — WSL/Remote commit diff not yet supported) */}
        {selectedFile && selectedHash && commitDetail && gitSource.type === "local" && (
          <div className="h-[45%] border-t border-border min-h-0">
            <CommitDiffView
              projectId={gitSource.projectId}
              commitHash={selectedHash}
              filePath={selectedFile}
              diffMode={diffMode}
            />
          </div>
        )}
      </div>

      {/* New Branch Dialog */}
      {newBranchDialog && (
        <Dialog open onOpenChange={(open) => !open && handleCloseNewBranchDialog()}>
          <DialogContent className="max-w-[420px]">
            <DialogHeader>
              <DialogTitle>New Branch</DialogTitle>
            </DialogHeader>
            <div className="text-[calc(var(--font-size)-1px)] text-text-muted mb-2">
              Based on: <span className="font-mono text-accent">{newBranchDialog.sourceBranch}</span>
            </div>
            <Input
              placeholder="Branch name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newBranchName.trim() && handleCreateBranch()}
              autoFocus
            />
            {newBranchError && (
              <p className="text-red-400 bg-red-400/10 border border-red-400/30 rounded-md p-2 mt-2 text-[13px]">
                {newBranchError}
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={handleCloseNewBranchDialog}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateBranch} disabled={!newBranchName.trim() || newBranchSubmitting}>
                {newBranchSubmitting ? "Creating..." : "Create Branch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default React.memo(GitBranchPanel);
