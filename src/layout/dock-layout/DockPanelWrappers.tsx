import React, { useCallback, useEffect, useRef } from "react";
import { revealInFileManager, readDirTree } from "@/features/file/api/fileApi";
import { listen } from "@tauri-apps/api/event";
import { useAppContext } from "@/shared/contexts";
import { useFileActionsContext } from "@/features/editor/FileActionsContext";
import { useFileStore } from "@/features/file/store";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from '@/shared/store';
import { useConnectionStore } from "@/features/connection/store";
import { useDockStore } from "@/shared/store/dockStore";
import FilesPanel from "@/features/file/components/FilesPanel";
import SkillsPanel from "@/features/skill/components/SkillsPanel";
import GitCommitPanel from "@/features/git/components/GitCommitPanel";
import ConversationPanel from "@/features/conversation/components/ConversationPanel";
import { useActiveProject } from "@/features/project/hooks/use-active-project";
import { buildDiffSource } from "@/shared/utils/diffSource";
import { openHtmlInBrowserPanel, resolveAbsolutePath } from "@/shared/utils/browserUtils";
import { DEFAULT_TREE_DEPTH } from '@/shared/types/file';
import { mergeSubTree } from "@/shared/utils/fileTree";
import type { Tab, FileTreeChangedEvent } from '@/shared/types';
import type { ConversationMeta } from '@/features/conversation/types';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

// ── FilesPanelWrapper ──

/**
 * Thin wrapper that reads file context + store and passes props to FilesPanel.
 * Triggers file tree loading when the files panel becomes active.
 *
 * For local projects: delegates to onLoadFileTree (context → useFileView → invoke).
 * For WSL/Remote projects: calls commands.readDirTree directly and updates the store.
 */
const FilesPanelWrapper: React.FC = React.memo(() => {
  const { onFileSelect, onFileRefresh, onLoadFileTree, onExpandDir } =
    useFileActionsContext();
  const { project, commands, worktreePath } = useActiveProject();
  const projectName = project?.name ?? null;
  const fileRootPath = worktreePath ?? project?.path ?? null;
  const fileTree = useFileStore((s) => s.fileTree);
  const fileViewLoading = useFileStore((s) => s.fileViewLoading);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectPath = fileRootPath;
  const changedFiles = project?.gitInfo?.changed_files;

  // Compute projectId for use by child components (drag-and-drop, etc.)
  const projectId = project ? (project.type === "local" ? activeProjectId : project.id) : null;

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

    // For local projects: load when panel just became active, when switching
    // to a different project (e.g., from WSL/Remote back to local), or when
    // fileRootPath actually changed within the same project (e.g., worktree switch).
    // Skip when only the project object reference changed (e.g., git-changed re-fetch)
    // but the project ID and fileRootPath are the same.
    if (project.type === "local" && activeProjectId) {
      if (justBecameActive || !sameProject || (sameProject && fileRootPathChanged)) {
        onLoadFileTree(activeProjectId, fileRootPath);
      }
    } else if (project.type !== "local" && commands) {
      // WSL/Remote: always load since there's no handleSelectProjectWithClear for them
      useFileStore.setState({ fileViewLoading: true });
      commands.readDirTree(fileRootPath, undefined, DEFAULT_TREE_DEPTH)
        .then((tree) => {
          useFileStore.setState({ fileTree: tree, fileViewLoading: false });
        })
        .catch((err) => {
          console.error("[FilesPanelWrapper] Failed to load WSL/Remote file tree:", err);
          useFileStore.setState({ fileTree: [], fileViewLoading: false });
        });
    }

    prevProjectIdRef.current = projectId ?? null;
    prevIsActiveRef.current = isActive;
    prevFileRootPathRef.current = fileRootPath;
  }, [isActive, project, activeProjectId, fileRootPath, commands, onLoadFileTree]);

  // 监听后端 file-tree-changed 事件（文件新增/删除/重命名），静默刷新目录树
  // 静默刷新：不设 fileViewLoading，旧树保持展示直到新数据到达，避免闪烁
  // 仅本地项目响应此事件（WSL/Remote 不经过本地 notify watcher）
  useEffect(() => {
    const unlistenPromise = listen<FileTreeChangedEvent>("file-tree-changed", (event) => {
      const { project_id } = event.payload;
      // 只响应当前活动项目的事件
      if (!activeProjectId || project_id !== activeProjectId) return;
      // panel 未激活时跳过（下次激活时 justBecameActive 逻辑会自动加载）
      if (!isActive || !fileRootPath) return;
      // 静默刷新：直接调用 API，不触发 loading 状态，旧树保持可见
      readDirTree(
        { Local: { project_path: fileRootPath } },
        null,
        null,
        DEFAULT_TREE_DEPTH,
      )
        .then((tree) => {
          useFileStore.setState({ fileTree: tree });
        })
        .catch(console.error);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [activeProjectId, isActive, fileRootPath]);

  // WSL/Remote: use commands.readDirTree directly for refresh, bypassing
  // useFileView.loadFileTree to avoid stale ref issues.
  // Local: delegate to onFileRefresh (context → useFileView.loadFileTree).
  const handleRefresh = useCallback(() => {
    if (project?.type !== "local" && commands && fileRootPath) {
      useFileStore.setState({ fileViewLoading: true });
      commands.readDirTree(fileRootPath, undefined, DEFAULT_TREE_DEPTH)
        .then((tree) => {
          useFileStore.setState({ fileTree: tree, fileViewLoading: false });
        })
        .catch((err) => {
          console.error("[FilesPanelWrapper] Refresh failed:", err);
          useFileStore.setState({ fileTree: [], fileViewLoading: false });
        });
    } else {
      onFileRefresh();
    }
  }, [project?.type, commands, fileRootPath, onFileRefresh]);

  // 懒加载子目录：WSL/Remote 直接通过 commands，Local 通过 context（useFileView.expandSubTree）
  const handleExpandDir = useCallback(async (dirPath: string) => {
    if (project?.type !== "local" && commands && fileRootPath) {
      // WSL/Remote：直接通过 commands.readDirTree 加载子树
      const subChildren = await commands.readDirTree(fileRootPath, dirPath, DEFAULT_TREE_DEPTH);
      const currentTree = useFileStore.getState().fileTree;
      const merged = mergeSubTree(currentTree, dirPath, subChildren);
      useFileStore.setState({ fileTree: merged });
    } else {
      // Local：委托给 context（→ useFileView.expandSubTree）
      await onExpandDir(dirPath);
    }
  }, [project?.type, commands, fileRootPath, onExpandDir]);

  // 在 Browser Panel 中打开 HTML 文件（仅本地项目）
  // filePath 是相对于项目根的路径，需要拼接为绝对路径
  const handleOpenInBrowser = useCallback((filePath: string) => {
    if (project?.type === "local" && projectPath) {
      openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, filePath));
    }
  }, [project?.type, projectPath]);

  // 在系统文件管理器中显示文件（确保传绝对路径）
  const handleRevealInExplorer = useCallback((filePath: string) => {
    const absPath = projectPath ? resolveAbsolutePath(projectPath, filePath) : filePath;
    revealInFileManager(absPath).catch((err) => {
      console.error("[FilesPanelWrapper] Failed to reveal in file manager:", err);
    });
  }, [projectPath]);

  return (
    <FilesPanel
      projectName={projectName}
      projectPath={projectPath}
      projectId={projectId}
      fileTree={fileTree}
      isLoading={fileViewLoading}
      activeFilePath={activeFilePath}
      onSelectFile={onFileSelect}
      onRefresh={handleRefresh}
      onExpandDir={handleExpandDir}
      projectType={project?.type ?? null}
      onOpenInBrowser={handleOpenInBrowser}
      onRevealInExplorer={handleRevealInExplorer}
      changedFiles={changedFiles}
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
  const { showToast } = useAppContext();
  const { project, commands, capabilities, connectionContext } = useActiveProject();
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);

  const onRefreshGit = useCallback(async () => {
    if (!project || !commands) return;
    const gitInfo = await commands.refreshGitInfo();
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === project.id ? { ...p, git_info: gitInfo } : p,
      );
      return {
        projects: nextProjects,
        activeProject:
          state.activeProjectId === project.id
            ? (nextProjects.find((p) => p.id === project.id) ?? state.activeProject)
            : state.activeProject,
      };
    });
  }, [project, commands]);

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
    // tabKey 需要与 MainContent 对齐：使用 store 中的原始项目 ID，
    // 而非 use-active-project 的统一 ID（wsl:distro:path / remote:host:path）
    const projectState = useProjectStore.getState();
    const connectionState = useConnectionStore.getState();
    const editorState = useEditorStore.getState();
    const tabKey = projectState.activeProjectId
      ?? connectionState.activeWslProject?.project.id
      ?? connectionState.activeRemoteProject?.project.id
      ?? project.id;
    const existingTabs = editorState.tabs[tabKey];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath,
    );
    if (existingDiffTab) {
      editorState.activateTab(tabKey, existingDiffTab.id);
      return;
    }

    const diffSource = buildDiffSource(connectionContext, activeWorktreePath);
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const tabId = `tab_${crypto.randomUUID()}`;
    const tab: Tab = {
      id: tabId,
      projectId: tabKey,
      title: fileName,
      order: existingTabs?.tabs.length ?? 0,
      data: { kind: "diff", filePath, fileName, diffSource },
    };
    editorState.addTab(tabKey, tab);
    editorState.activateTab(tabKey, tabId);
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
 * Renders SkillsPanel — data is sourced from the global skillStore singleton,
 * no Provider wrapper needed.
 */
const SkillsPanelWrapper: React.FC = React.memo(() => {
  return <SkillsPanel />;
});
SkillsPanelWrapper.displayName = "SkillsPanelWrapper";

// ── ConversationsPanelWrapper ──

/**
 * Thin wrapper that reads project context + agent list and passes props
 * to ConversationPanel. Handles terminal tab creation for conversation resume.
 */
const ConversationsPanelWrapper: React.FC = React.memo(() => {
  const { project, worktreePath } = useActiveProject();
  const { agents, showToast } = useAppContext();

  const projectPath = worktreePath ?? project?.path ?? null;
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === "conversations" && zone.expanded) return true;
    }
    return false;
  });

  // Determine project ID and tab key for opening conversation tabs
  const localActiveProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWslProject = useConnectionStore((s) => s.activeWslProject);
  const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
  const currentProjectId = localActiveProjectId
    ?? activeWslProject?.project.id
    ?? activeRemoteProject?.project.id
    ?? null;
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const tabKey = activeWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
    : currentProjectId;

  const handleOpenConversationTab = useCallback((meta: ConversationMeta) => {
    const editorState = useEditorStore.getState();
    const existingTabs = tabKey ? editorState.tabs[tabKey] : undefined;
    const tabId = `tab_${crypto.randomUUID()}`;
    const tab: Tab = {
      id: tabId,
      projectId: currentProjectId ?? tabKey ?? 'conversation',
      title: meta.title,
      order: existingTabs?.tabs.length ?? 0,
      data: {
        kind: "conversation",
        conversationId: meta.id,
        agentId: meta.agentId,
      },
    };
    if (tabKey) {
      editorState.addTab(tabKey, tab);
      editorState.activateTab(tabKey, tabId);
    }
  }, [currentProjectId, tabKey]);

  const handleResumeConversation = useCallback(async (meta: ConversationMeta) => {
    if (!currentProjectId || !tabKey) {
      showToast('No project selected', 'error');
      return;
    }
    const { getAgent } = await import('@/features/agent/api/agentApi');
    const { getResumeCommand } = await import('@/features/conversation/api/conversationApi');
    // Get agent config
    let agentCommand: string;
    try {
      const agent = await getAgent(meta.agentId);
      agentCommand = agent.command;
    } catch {
      showToast(`Agent "${meta.agentId}" not found`, 'error');
      return;
    }

    // Get resume command from backend
    let resumeCmd: string[] | null = null;
    try {
      resumeCmd = await getResumeCommand(meta.id);
    } catch (err) {
      console.warn('[ConversationsPanel] Failed to get resume command:', err);
    }

    // Build the full command to execute in the PTY
    let taskCommand: string | undefined;
    if (resumeCmd && resumeCmd.length > 0) {
      // Native resume: adapter returns e.g. ["--resume", "<id>"] or ["resume", "<id>"]
      taskCommand = `${agentCommand} ${resumeCmd.join(' ')}`;
    } else {
      // No native resume: just open the agent
      taskCommand = agentCommand;
    }

    // Create a new terminal tab — the PTY will execute taskCommand directly
    const tabId = `tab_${crypto.randomUUID()}`;
    const editorState = useEditorStore.getState();
    const existingTabs = editorState.tabs[tabKey];
    const terminalCount = (existingTabs?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
    if (terminalCount >= 10) {
      showToast('Maximum terminal tabs reached', 'error');
      return;
    }
    const tab: Tab = {
      id: tabId,
      projectId: currentProjectId,
      title: meta.agentId,
      order: existingTabs?.tabs.length ?? 0,
      data: {
        kind: 'terminal',
        agentId: meta.agentId,
        status: 'Idle',
        taskCommand,
      },
    };
    editorState.addTab(tabKey, tab);
    editorState.activateTab(tabKey, tabId);
  }, [currentProjectId, tabKey, showToast]);

  return (
    <ConversationPanel
      projectPath={projectPath}
      projectId={currentProjectId}
      agents={agents}
      isActive={isActive}
      showToast={showToast}
      onOpenConversationTab={handleOpenConversationTab}
      onResumeConversation={handleResumeConversation}
    />
  );
});
ConversationsPanelWrapper.displayName = "ConversationsPanelWrapper";

export { FilesPanelWrapper, GitCommitPanelWrapper, SkillsPanelWrapper, ConversationsPanelWrapper };
