import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../../types";
import type { DialogType } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";
import WorktreeList from "./WorktreeList";
import { BranchIcon, ChevronRightIcon, PlusIcon, SearchIcon, TerminalIcon } from "../icons";

interface ProjectGitSectionProps {
  project: Project;
  isActive: boolean;
  expandedSections: Record<string, boolean>;
  actions: {
    onToggleSection: (key: string, e: React.MouseEvent) => void;
    onSelectProject: (projectId: string) => void;
    onSelectFile: (projectId: string, filePath: string) => void;
    onRefreshGit: (projectId: string) => void;
    onBackToMainTerminal: (projectId: string) => void;
    onOpenDialog: (type: DialogType, e: React.MouseEvent) => void;
    onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
    onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
    onShowToast?: (message: string, type?: "info" | "error") => void;
  };
}

export default function ProjectGitSection({
  project,
  isActive,
  expandedSections,
  actions,
}: ProjectGitSectionProps) {
  const {
    onToggleSection,
    onSelectProject,
    onSelectFile,
    onRefreshGit,
    onBackToMainTerminal,
    onOpenDialog,
    onOpenWorktreeTerminal,
    onSelectWorktreeFile,
    onShowToast,
  } = actions;

  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const branchSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branchDropdownOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
        setBranchSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdownOpen]);

  useEffect(() => {
    if (branchDropdownOpen && branchSearchInputRef.current) {
      branchSearchInputRef.current.focus();
    }
  }, [branchDropdownOpen]);

  const changedFiles = project.git_info?.changed_files ?? [];
  const tree = useMemo(() => buildTree(changedFiles), [changedFiles]);
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of changedFiles) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { totalAdditions: additions, totalDeletions: deletions };
  }, [changedFiles]);

  const branches = project.git_info?.branches ?? [];
  const worktrees = project.git_info?.worktrees ?? [];
  const currentBranch = project.git_info?.current_branch ?? "";
  const localExpanded = expandedSections.__local__ !== false;
  const localChangesExpanded = expandedSections.__local_changes__ !== false;

  const filteredBranches = useMemo(() => {
    const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
    return branches.filter((b) => !worktreeBranchSet.has(b));
  }, [worktrees, branches]);

  const dropdownBranches = useMemo(() => {
    const q = branchSearchQuery.toLowerCase().trim();
    if (!q) {
      return filteredBranches;
    }
    return filteredBranches.filter((b) => b.toLowerCase().includes(q));
  }, [filteredBranches, branchSearchQuery]);

  const handleCheckoutFromDropdown = async (branchName: string) => {
    if (branchName === project.git_info?.current_branch) {
      return;
    }
    setBranchDropdownOpen(false);
    setBranchSearchQuery("");
    try {
      await invoke("checkout_branch", { projectId: project.id, branchName });
      onBackToMainTerminal(project.id);
      onRefreshGit(project.id);
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    }
  };

  return (
    <div className="py-0.5 pb-1">
      <div
        className={`group flex items-center gap-1 py-1 px-2 ml-2 mr-1 rounded-md transition-colors duration-100 cursor-pointer ${isActive ? "bg-bg-tertiary/60 text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
        onClick={() => onSelectProject(project.id)}
        title="Open primary terminal"
      >
        <button
          className="bg-transparent border-none cursor-pointer p-0 m-0 w-3 h-3 flex items-center justify-center text-text-muted hover:text-text-primary"
          onClick={(e) => onToggleSection("__local__", e)}
          title="Toggle local details"
        >
          <ChevronRightIcon
            size={9}
            className={`transition-transform duration-150 ${localExpanded ? "rotate-90" : ""}`}
          />
        </button>
        <TerminalIcon size={13} className="opacity-70 shrink-0" />
        <span className="flex-1 text-[var(--font-size)] font-semibold truncate min-w-0">
          local
        </span>
        {project.git_info && (
          <div className="relative min-w-0" ref={branchDropdownRef} onClick={(e) => e.stopPropagation()}>
            <span
              className={`gh-branch-inline flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40 ${branchDropdownOpen ? "bg-accent-blue/20 border-accent-blue/40" : ""}`}
              title={project.git_info.current_branch}
              onClick={() => setBranchDropdownOpen((v) => !v)}
            >
              <BranchIcon size={11} />
              {project.git_info.current_branch}
            </span>
            {branchDropdownOpen && (
              <div
                className="absolute top-[calc(100%+4px)] right-0 bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] z-[1000] shadow-xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1.5 p-2 px-2.5 border-b border-border">
                  <SearchIcon size={12} className="text-text-muted shrink-0" />
                  <input
                    ref={branchSearchInputRef}
                    className="gh-branch-dropdown-search-input flex-1 bg-transparent border-none outline-none text-text-primary text-xs font-inherit"
                    placeholder="Search branches..."
                    value={branchSearchQuery}
                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setBranchDropdownOpen(false);
                        setBranchSearchQuery("");
                      }
                    }}
                  />
                </div>
                <div className="max-h-[240px] overflow-y-auto py-1">
                  {dropdownBranches.map((branch) => {
                    const isCurrent = branch === currentBranch;
                    return (
                      <div
                        key={branch}
                        className={`flex items-center gap-1.5 py-1 px-3 text-xs font-mono text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary ${isCurrent ? "!text-accent-blue cursor-default" : ""}`}
                        onClick={() => handleCheckoutFromDropdown(branch)}
                        title={isCurrent ? "Current branch" : "Click to checkout"}
                      >
                        <BranchIcon size={11} />
                        <span className="flex-1 truncate">{branch}</span>
                        {isCurrent && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0"
                            title="current"
                          />
                        )}
                      </div>
                    );
                  })}
                  {dropdownBranches.length === 0 && (
                    <div className="p-3 text-center text-xs text-text-muted">
                      No branches found
                    </div>
                  )}
                </div>
                <div className="border-t border-border py-1">
                  <div
                    className="flex items-center gap-1.5 py-1 px-3 text-xs text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranchDropdownOpen(false);
                      setBranchSearchQuery("");
                      onOpenDialog("new-branch", e as unknown as React.MouseEvent);
                    }}
                  >
                    <PlusIcon size={11} />
                    New Branch
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {localExpanded && project.git_info && (
        <>
          {tree.length > 0 && (
            <>
              <div
                className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-0.5 px-2 ml-8 mr-1 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
                onClick={(e) => onToggleSection("__local_changes__", e)}
              >
                <ChevronRightIcon
                  size={9}
                  className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${localChangesExpanded ? "rotate-90" : ""}`}
                />
                Changes ({changedFiles.length})
                {(totalAdditions > 0 || totalDeletions > 0) && (
                  <span className="inline-flex items-center gap-1 ml-auto font-semibold text-[1.1em]">
                    {totalAdditions > 0 && (
                      <span className="text-[#3fb950] font-semibold">
                        +{totalAdditions}
                      </span>
                    )}
                    {totalDeletions > 0 && (
                      <span className="text-[#f85149] font-semibold">
                        -{totalDeletions}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {localChangesExpanded && (
                <div className="ml-10">
                  <FileTree
                    nodes={tree}
                    projectId={project.id}
                    onSelectFile={onSelectFile}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="ml-6">
        <WorktreeList
          worktrees={worktrees}
          projectId={project.id}
          expandedSections={expandedSections}
          toggleSection={onToggleSection}
          onOpenWorktreeTerminal={onOpenWorktreeTerminal}
          onSelectWorktreeFile={onSelectWorktreeFile}
          onRefreshGit={onRefreshGit}
          onShowToast={onShowToast}
        />
      </div>
    </div>
  );
}
