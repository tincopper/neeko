import React, { useEffect } from "react";
import {
  useFileActionsContext,
  useAppContext,
  useProjectActionsContext,
  SkillProvider,
} from "@/contexts";
import { useAppStore } from "@/store/appStore";
import { useDockStore } from "@/store/dockStore";
import { FilesPanel } from "@/components/panels";
import { SkillsPanel } from "@/components/skills";
import { GitCommitPanel } from "@/components/project";

// ── FilesPanelWrapper ──

/**
 * Thin wrapper that reads file context + store and passes props to FilesPanel.
 * Triggers file tree loading when the files panel becomes active.
 */
const FilesPanelWrapper: React.FC = React.memo(() => {
  const { onFileSelect, onFileRefresh, onLoadFileTree } =
    useFileActionsContext();
  const projectName = useAppStore((s) => s.activeProject?.name ?? null);
  const fileTree = useAppStore((s) => s.fileTree);
  const fileViewLoading = useAppStore((s) => s.fileViewLoading);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeWorktreePath = useAppStore((s) => s.activeWorktreePath);

  // Load file tree when this panel is the active tab in any zone
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === "files" && zone.expanded) return true;
    }
    return false;
  });

  useEffect(() => {
    if (isActive && activeProjectId) {
      onLoadFileTree(activeProjectId, activeWorktreePath ?? undefined);
    }
  }, [isActive, activeProjectId, activeWorktreePath, onLoadFileTree]);

  return (
    <FilesPanel
      projectName={projectName}
      fileTree={fileTree}
      isLoading={fileViewLoading}
      activeFilePath={activeFilePath}
      onSelectFile={onFileSelect}
      onRefresh={onFileRefresh}
    />
  );
});
FilesPanelWrapper.displayName = "FilesPanelWrapper";

// ── GitCommitPanelWrapper ──

/**
 * Thin wrapper that reads project actions context + store and passes props
 * to GitCommitPanel. Shows a placeholder when no project is selected.
 */
const GitCommitPanelWrapper: React.FC = React.memo(() => {
  const { onSelectFile, onRefreshGit } = useProjectActionsContext();
  const { showToast } = useAppContext();
  const activeProject = useAppStore((s) => s.activeProject);
  const activeWorktreeBranch = useAppStore((s) => s.activeWorktreeBranch);

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  // Override git_info.current_branch when a worktree is active
  const project = activeWorktreeBranch && activeProject.git_info
    ? {
        ...activeProject,
        git_info: {
          ...activeProject.git_info,
          current_branch: activeWorktreeBranch,
        },
      }
    : activeProject;

  return (
    <GitCommitPanel
      project={project}
      onRefreshGit={onRefreshGit}
      onSelectFile={onSelectFile}
      onShowToast={showToast}
    />
  );
});
GitCommitPanelWrapper.displayName = "GitCommitPanelWrapper";

// ── SkillsPanelWrapper ──

/**
 * Wraps SkillsPanel with its required SkillProvider context.
 * Each DockZone instance gets its own SkillProvider scope.
 */
const SkillsPanelWrapper: React.FC = React.memo(() => {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  return (
    <SkillProvider activeProjectId={activeProjectId}>
      <SkillsPanel />
    </SkillProvider>
  );
});
SkillsPanelWrapper.displayName = "SkillsPanelWrapper";

export { FilesPanelWrapper, GitCommitPanelWrapper, SkillsPanelWrapper };
