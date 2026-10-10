import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';

import { readDirTree } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession, useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import type { DirTreeResult } from '@/shared/types';
import { DEFAULT_TREE_DEPTH } from '@/shared/types/file';
import { isFileTab } from '@/shared/utils/fileTree';
import { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useFileViewTabOps } from './useFileViewTabOps';

/**
 * useFileView — 文件视图 hook
 *
 * Local / WSL / Remote 统一走 `fileApi`（后端按 `ExecTarget` 路由三端），
 * 不再经 ProjectCommands 文件双通道（R7）。
 */
export function useFileView() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const [error, setError] = useState<string | null>(null);

  // Unified current project ID — covers local/WSL/remote via unified store
  const currentProjectId = activeProjectId ?? activeProject?.id ?? null;

  // 当前视图单元的**身份值单点**（workspaceStore 唯一构造器，响应式）：地址、组键、refs 都由它派生。
  const workspace = useActiveWorkspaceSession(currentProjectId);

  // Composite tab key: worktree gets its own independent tab space
  const tabKey = workspace
    ? WorkspaceSession.of(workspace.projectId, workspace.worktreePath ?? null).key
    : null;

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
  const workspaceRef = useRef(workspace);

  // Ref 同步集中：所有 refs 在单个 effect 中同步（前端架构约定 3）。
  useEffect(() => {
    tabKeyRef.current = tabKey;
    workspaceRef.current = workspace;
  }, [tabKey, workspace]);

  /**
   * 构造目录加载器：Local / WSL / Remote 统一走 `readDirTree`（后端按 ExecTarget 路由三端），
   * 供 store.loadDir 注入 —— store 只治理数据生命周期，不感知命令实现。
   * S2-0 单层化：非根目录 depth=1 只读一级条目（展开懒加载 + 定向刷新 O(变更)）；
   * 根保留默认深度做一次性初始结构预扫。
   */
  const makeDirLoader = useCallback((workspace: WorkspaceSession, dirPath: string) => {
    const depth = dirPath ? 1 : DEFAULT_TREE_DEPTH;
    return (): Promise<DirTreeResult> => readDirTree(workspace, dirPath || null, depth);
  }, []);

  /** 解析当前 root 路径：当前视图单元为 worktree 时用其根，否则 activeProject.path */
  const resolveRootPath = useCallback(() => {
    return (
      workspaceRef.current?.worktreePath ?? useProjectStore.getState().activeProject?.path ?? null
    );
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
    async (projectId: ProjectId, worktreePath?: string, force = false) => {
      const rootPath = worktreePath ?? useProjectStore.getState().activeProject?.path ?? null;
      if (!rootPath) return;
      const owner = `${projectId}:${rootPath}`;
      // 地址 = 该项目的当前Workspace（主仓 worktreePath=null）；rootPath 仅作缓存 owner 键。
      const workspace = activeWorkspaceSession(projectId);
      // force（手动/自动刷新）：全树刷新，重载根 + 所有已展开子目录，保证
      // 移动/删除文件后展开目录缓存同步更新；否则只做根加载（幂等/首载）。
      if (force) {
        await useFileStore
          .getState()
          .refreshTree(owner, (dirPath) => makeDirLoader(workspace, dirPath));
      } else {
        const loader = makeDirLoader(workspace, '');
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
      const loader = makeDirLoader(activeWorkspaceSession(projectId), dirPath);
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
    saveTabById,
    setTabDirty,
    clearFileView,
  } = useFileViewTabOps({
    tabKeyRef,
    workspaceRef,
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
    saveTabById,
    setTabDirty,
    clearFileView,
  };
}
