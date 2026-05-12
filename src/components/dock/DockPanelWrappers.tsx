import React, { useCallback, useEffect, useRef } from "react";
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
import { useActiveProject } from "@/hooks/useActiveProject";

// ── FilesPanelWrapper ──

/**
 * Thin wrapper that reads file context + store and passes props to FilesPanel.
 * Triggers file tree loading when the files panel becomes active.
 *
 * For local projects: delegates to onLoadFileTree (context → useFileView → invoke).
 * For WSL/Remote projects: calls commands.readDirTree directly and updates the store.
 */
const FilesPanelWrapper: React.FC = React.memo(() => {
  const { onFileSelect, onFileRefresh, onLoadFileTree } =
    useFileActionsContext();
  const { project, commands, worktreePath } = useActiveProject();
  const projectName = project?.name ?? null;
  const fileRootPath = worktreePath ?? project?.path ?? null;
  const fileTree = useAppStore((s) => s.fileTree);
  const fileViewLoading = useAppStore((s) => s.fileViewLoading);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projectPath = fileRootPath;

  // Load file tree when this panel is the active tab in any zone
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === "files" && zone.expanded) return true;
    }
    return false;
  });

  // Track previous values to avoid redundant file tree loads.
  // This effect should only fire when:
  //   1. Panel transitions from inactive → active (isActive flips to true)
  //   2. fileRootPath changes within the SAME project (e.g., worktree switch)
  //   3. WSL/Remote project needs initial tree load
  const prevProjectIdRef = useRef<string | null>(null);
  const prevIsActiveRef = useRef(false);
  const prevFileRootPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || !project || !fileRootPath) {
      prevIsActiveRef.current = isActive;
      return;
    }

    const projectId = project.type === "local" ? activeProjectId : project.id;
    const justBecameActive = !prevIsActiveRef.current && isActive;
    const sameProject = prevProjectIdRef.current === projectId;
    const fileRootPathChanged = fileRootPath !== prevFileRootPathRef.current;

    // For local projects: only load when panel just became active, or when
    // fileRootPath actually changed within the same project (e.g., worktree switch).
    // Skip when only the project object reference changed (e.g., git-changed re-fetch)
    // but the project ID and fileRootPath are the same.
    if (project.type === "local" && activeProjectId) {
      if (justBecameActive || (sameProject && fileRootPathChanged)) {
        onLoadFileTree(activeProjectId, fileRootPath);
      }
    } else if (project.type !== "local" && commands) {
      // WSL/Remote: always load since there's no handleSelectProjectWithClear for them
      useAppStore.setState({ fileViewLoading: true });
      commands.readDirTree(fileRootPath, undefined, 4)
        .then((tree) => {
          useAppStore.setState({ fileTree: tree, fileViewLoading: false });
        })
        .catch((err) => {
          console.error("[FilesPanelWrapper] Failed to load WSL/Remote file tree:", err);
          useAppStore.setState({ fileTree: [], fileViewLoading: false });
        });
    }

    prevProjectIdRef.current = projectId ?? null;
    prevIsActiveRef.current = isActive;
    prevFileRootPathRef.current = fileRootPath;
  }, [isActive, project, activeProjectId, fileRootPath, commands, onLoadFileTree]);

  // WSL/Remote: use commands.readDirTree directly for refresh, bypassing
  // useFileView.loadFileTree to avoid stale ref issues.
  // Local: delegate to onFileRefresh (context → useFileView.loadFileTree).
  const handleRefresh = useCallback(() => {
    if (project?.type !== "local" && commands && fileRootPath) {
      useAppStore.setState({ fileViewLoading: true });
      commands.readDirTree(fileRootPath, undefined, 4)
        .then((tree) => {
          useAppStore.setState({ fileTree: tree, fileViewLoading: false });
        })
        .catch((err) => {
          console.error("[FilesPanelWrapper] Refresh failed:", err);
          useAppStore.setState({ fileTree: [], fileViewLoading: false });
        });
    } else {
      onFileRefresh();
    }
  }, [project?.type, commands, fileRootPath, onFileRefresh]);

  return (
    <FilesPanel
      projectName={projectName}
      projectPath={projectPath}
      fileTree={fileTree}
      isLoading={fileViewLoading}
      activeFilePath={activeFilePath}
      onSelectFile={onFileSelect}
      onRefresh={handleRefresh}
    />
  );
});
FilesPanelWrapper.displayName = "FilesPanelWrapper";

// ── GitCommitPanelWrapper ──

/**
 * Thin wrapper that reads unified project context and passes props
 * to GitCommitPanel. Shows a placeholder when no project is selected.
 */
const GitCommitPanelWrapper: React.FC = React.memo(() => {
  const { onSelectFile } = useProjectActionsContext();
  const { showToast } = useAppContext();
  const { project, commands, capabilities } = useActiveProject();
  const activeWorktreeBranch = useAppStore((s) => s.activeWorktreeBranch);

  const onRefreshGit = useCallback(async () => {
    if (!commands) return;
    await commands.refreshGitInfo();
  }, [commands]);

  if (!project || !commands || !capabilities) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  // Override gitInfo.current_branch when a worktree is active
  const effectiveProject =
    activeWorktreeBranch && project.gitInfo
      ? {
          ...project,
          gitInfo: {
            ...project.gitInfo,
            current_branch: activeWorktreeBranch,
          },
        }
      : project;

  const handleSelectFile = (filePath: string) => {
    onSelectFile(project.id, filePath);
  };

  return (
    <GitCommitPanel
      project={effectiveProject}
      commands={commands}
      capabilities={capabilities}
      onRefreshGit={onRefreshGit}
      onSelectFile={handleSelectFile}
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
