import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';

import { readDirTree } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileNode } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';
import { DEFAULT_TREE_DEPTH } from '@/shared/types/file';
import { isFileTab } from '@/shared/utils/fileTree';
import { resolveTabKey } from '@/shared/utils/tabKey';

import { useFileViewTabOps } from './useFileViewTabOps';

/** 从 store 读取指定项目的 .gitignore 忽略列表（供文件树剪枝，undefined 表示不剪枝） */
function getIgnoredFiles(projectId: string): string[] | undefined {
  return useProjectStore.getState().projects.find((p) => p.id === projectId)?.git_info
    ?.ignored_files;
}

/**
 * useFileView �?文件视图 hook
 *
 * 支持两种模式�?
 * - 无参�?(local 模式): �?store 读取 activeProjectId / activeWorktreePath，直�?invoke
 * - 传入 externalCommands / externalWorktreePath (WSL/Remote 模式): 通过 ProjectCommands 接口调用
 *
 * 选项 A：最小改动，保证本地功能不受影响，WSL/Remote 通过 externalCommands 接入�?
 */
export function useFileView(
  externalCommands?: ProjectCommands | null,
  externalWorktreePath?: string | null,
) {
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);
  const [error, setError] = useState<string | null>(null);

  // Unified current project ID — covers local/WSL/remote via unified store
  const currentProjectId = activeProjectId ?? activeProject?.id ?? null;

  // Resolve effective worktree path: external takes priority
  const effectiveWorktreePath =
    externalWorktreePath !== undefined ? externalWorktreePath : activeWorktreePath;

  // Composite tab key: worktree gets its own independent tab space
  const tabKey = currentProjectId
    ? resolveTabKey(currentProjectId, effectiveWorktreePath)
    : currentProjectId;

  // Read project tabs from unified store using tabKey
  const projectTabs = useEditorStore(
    useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
    }),
  );

  // Derive file tabs (filtered by kind === "file")
  const fileTabs = useMemo(() => {
    if (!projectTabs) return [];
    return projectTabs.tabs.filter(isFileTab);
  }, [projectTabs]);

  // Derive active file tab ID
  const activeFileTabId = useMemo(() => {
    if (!projectTabs) return null;
    // Prefer the project's active tab if it's a file tab
    const active = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
    if (active && active.data.kind === 'file') return active.id;
    // Fall back to first file tab
    const first = projectTabs.tabs.find(isFileTab);
    return first?.id ?? null;
  }, [projectTabs]);

  // Derive active file path
  const activeFilePath = useMemo(() => {
    if (!activeFileTabId) return null;
    const tab = fileTabs.find((t) => t.id === activeFileTabId);
    return tab?.data.filePath ?? null;
  }, [fileTabs, activeFileTabId]);

  // Refs for callbacks (avoids stale closures)
  const tabKeyRef = useRef(tabKey);
  const worktreePathRef = useRef(effectiveWorktreePath);
  const externalCommandsRef = useRef(externalCommands);

  // Sync refs after render so callbacks always read latest values
  useEffect(() => {
    tabKeyRef.current = tabKey;
  }, [tabKey]);
  useEffect(() => {
    worktreePathRef.current = effectiveWorktreePath;
  }, [effectiveWorktreePath]);
  useEffect(() => {
    externalCommandsRef.current = externalCommands;
  }, [externalCommands]);

  /**
   * 构造目录加载器：按项目类型分发（Local 走 readDirTree 命令，WSL/Remote 走 ProjectCommands），
   * 供 store.loadDir 注入 —— store 只治理数据生命周期，不感知命令实现。
   */
  const makeDirLoader = useCallback((projectId: string, rootPath: string, dirPath: string) => {
    const cmds = externalCommandsRef.current;
    const ignored = getIgnoredFiles(projectId);
    return (): Promise<FileNode[]> =>
      cmds
        ? cmds.readDirTree(rootPath, dirPath || undefined, DEFAULT_TREE_DEPTH, ignored)
        : readDirTree(projectId, dirPath, rootPath, undefined, ignored);
  }, []);

  /** 解析当前 root 路径：外部（WSL/Remote worktree）优先，否则 activeProject.path */
  const resolveRootPath = useCallback(() => {
    return worktreePathRef.current ?? useProjectStore.getState().activeProject?.path ?? null;
  }, []);

  /**
   * Load the directory tree for a project.
   *
   * @param force - When true, bypasses the "already loaded" idempotency check and
   *   always re-fetches. Defaults to false to mirror store.loadDir semantics: manual
   *   refresh should pass `force = true`; activation / project switch are idempotent
   *   (a fresh owner still loads because loadDir resets the cache on owner change).
   */
  const loadFileTree = useCallback(
    async (projectId: string, worktreePath?: string, force = false) => {
      const rootPath = worktreePath ?? useProjectStore.getState().activeProject?.path ?? null;
      if (!rootPath) return;
      const owner = `${projectId}:${rootPath}`;
      // force（手动/自动刷新）：全树刷新，重载根 + 所有已展开子目录，保证
      // 移动/删除文件后展开目录缓存同步更新；否则只做根加载（幂等/首载）。
      if (force) {
        await useFileStore
          .getState()
          .refreshTree(owner, (dirPath) => makeDirLoader(projectId, rootPath, dirPath));
      } else {
        const loader = makeDirLoader(projectId, rootPath, '');
        await useFileStore.getState().loadDir(owner, '', loader);
      }
    },
    [makeDirLoader],
  );

  /**
   * 懒加载子目录：展开超过初始深度的目录时，按需加载该目录的内容
   * （store 幂等：已 loaded/loading 跳过；根刷新不影响已加载的子目录缓存）
   */
  const expandSubTree = useCallback(
    async (dirPath: string) => {
      const projectId = useProjectStore.getState().activeProjectId ?? null;
      if (!projectId) return;
      const rootPath = resolveRootPath();
      if (!rootPath) return;
      const owner = `${projectId}:${rootPath}`;
      const loader = makeDirLoader(projectId, rootPath, dirPath);
      await useFileStore.getState().loadDir(owner, dirPath, loader);
    },
    [makeDirLoader, resolveRootPath],
  );

  const {
    openFile,
    closeTab,
    activateTab,
    updateTabContent,
    saveFile,
    setTabDirty,
    clearFileView,
  } = useFileViewTabOps({
    tabKeyRef,
    worktreePathRef,
    externalCommandsRef,
    setError,
  });

  return {
    activeFilePath,
    error,
    loadFileTree,
    expandSubTree,
    openFile,
    closeTab,
    activateTab,
    updateTabContent,
    saveFile,
    setTabDirty,
    clearFileView,
  };
}
