import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef } from 'react';

import { readDirTree } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { FILE_TREE_CHANGED_EVENT } from '@/shared/events';
import type { ProjectCommands, ProjectView, FileTreeChangedEvent } from '@/shared/types';
import { DEFAULT_TREE_DEPTH } from '@/shared/types/file';

export interface UseFileTreeSyncOptions {
  project: ProjectView | null;
  commands: ProjectCommands | null;
  activeProjectId: string | null;
  /** 文件树根路径（worktree 或项目根） */
  fileRootPath: string | null;
  ignoredFiles: string[];
  /** 面板在 dock 中是否激活（激活时才发起首次加载） */
  isActive: boolean;
  onLoadFileTree: (pid: string, rootPath: string) => void;
  onFileRefresh: () => void;
  onExpandDir: (dirPath: string) => Promise<void>;
}

/**
 * 文件树同步编排（本地 vs WSL/Remote 双路径）。
 *
 * 内聚目录加载 / file-tree-changed 事件刷新 / 手动刷新 / 懒加载展开，
 * 使 FilesPanelWrapper 保持薄适配、可独立测试。
 *
 * - 目录加载器：封装「本地命令」与「WSL/Remote 命令」两种实现，注入 store
 *   （store 不感知命令差异）；
 * - 加载 effect：面板激活切换 / fileRootPath 变化 / WSL-Remote 首次加载时触发，
 *   通过 prev refs 避免冗余加载；
 * - 事件监听：仅本地项目响应 file-tree-changed（WSL/Remote 不经过本地 notify
 *   watcher），静默全树刷新（不切换 loading 态）。
 */
export function useFileTreeSync({
  project,
  commands,
  activeProjectId,
  fileRootPath,
  ignoredFiles,
  isActive,
  onLoadFileTree,
  onFileRefresh,
  onExpandDir,
}: UseFileTreeSyncOptions) {
  const makeLocalLoader = useCallback(
    (pid: string, dirPath: string) => () =>
      readDirTree(pid, dirPath, fileRootPath, DEFAULT_TREE_DEPTH, ignoredFiles),
    [fileRootPath, ignoredFiles],
  );
  const makeWslRemoteLoader = useCallback(
    (dirPath: string) => () => {
      if (!commands || !fileRootPath) {
        return Promise.reject(new Error('commands unavailable'));
      }
      return commands.readDirTree(
        fileRootPath,
        dirPath || undefined,
        DEFAULT_TREE_DEPTH,
        ignoredFiles,
      );
    },
    [commands, fileRootPath, ignoredFiles],
  );

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

    const projectId = project.type === 'Local' ? activeProjectId : project.id;
    const justBecameActive = !prevIsActiveRef.current && isActive;
    const sameProject = prevProjectIdRef.current === projectId;
    const fileRootPathChanged = fileRootPath !== prevFileRootPathRef.current;

    // For local projects: load when panel just became active, when switching
    // to a different project (e.g., from WSL/Remote back to local), or when
    // fileRootPath actually changed within the same project (e.g., worktree switch).
    // Skip when only the project object reference changed (e.g., git-changed re-fetch)
    // but the project ID and fileRootPath are the same.
    if (project.type === 'Local' && activeProjectId) {
      if (justBecameActive || !sameProject || (sameProject && fileRootPathChanged)) {
        onLoadFileTree(activeProjectId, fileRootPath);
      }
    } else if (project.type !== 'Local' && commands) {
      // WSL/Remote: always load since there's no handleSelectProjectWithClear for them
      const owner = `${project.id}:${fileRootPath}`;
      const loader = makeWslRemoteLoader('');
      void useFileStore.getState().loadDir(owner, '', loader);
    }

    prevProjectIdRef.current = projectId ?? null;
    prevIsActiveRef.current = isActive;
    prevFileRootPathRef.current = fileRootPath;
  }, [
    isActive,
    project,
    activeProjectId,
    fileRootPath,
    commands,
    onLoadFileTree,
    makeWslRemoteLoader,
  ]);

  // 监听后端 file-tree-changed 事件（文件新增/删除/重命名），静默刷新目录树
  // 静默刷新：不切换 loading 态，旧树保持展示直到新数据到达，避免闪烁
  // 仅本地项目响应此事件（WSL/Remote 不经过本地 notify watcher）
  useEffect(() => {
    const unlistenPromise = listen<FileTreeChangedEvent>(FILE_TREE_CHANGED_EVENT, (event) => {
      const { project_id } = event.payload;
      // 只响应当前活动项目的事件 + 仅本地项目（WSL/Remote 不经过本地 notify watcher）
      if (!activeProjectId || project_id !== activeProjectId) return;
      if (!project || project.type !== 'Local') return;
      // 移除 isActive 限制：即使文件面板未激活，文件变更仍应触发刷新，
      // 确保用户切换到文件面板时看到的是最新状态。
      if (!fileRootPath) return;
      // 静默刷新：全树刷新，重载根 + 所有已展开子目录（根治展开目录被整树覆盖，
      // 并保证移动/删除文件后展开目录缓存同步更新）。后台刷新不切换 loading 态，
      // 旧树保持可见直到新数据到达。
      const owner = `${activeProjectId}:${fileRootPath}`;
      void useFileStore
        .getState()
        .refreshTree(owner, (dirPath) => makeLocalLoader(activeProjectId, dirPath), {
          silent: true,
        });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [activeProjectId, project, fileRootPath, ignoredFiles, makeLocalLoader]);

  // WSL/Remote: 通过 store.refreshTree 强制全树重载（失败保留旧内容 + error 态，不置空）。
  // Local: delegate to onFileRefresh (context → useFileView.loadFileTree, force 全树刷新)。
  const handleRefresh = useCallback(() => {
    if (project && project.type !== 'Local' && commands && fileRootPath) {
      const owner = `${project.id}:${fileRootPath}`;
      void useFileStore.getState().refreshTree(owner, (dirPath) => makeWslRemoteLoader(dirPath));
    } else {
      onFileRefresh();
    }
  }, [project, commands, fileRootPath, onFileRefresh, makeWslRemoteLoader]);

  // 懒加载子目录：WSL/Remote 通过 store.loadDir（幂等），Local 通过 context（useFileView.expandSubTree）
  const handleExpandDir = useCallback(
    async (dirPath: string) => {
      if (project && project.type !== 'Local' && commands && fileRootPath) {
        const owner = `${project.id}:${fileRootPath}`;
        const loader = makeWslRemoteLoader(dirPath);
        await useFileStore.getState().loadDir(owner, dirPath, loader);
      } else {
        // Local：委托给 context（→ useFileView.expandSubTree）
        await onExpandDir(dirPath);
      }
    },
    [project, commands, fileRootPath, onExpandDir, makeWslRemoteLoader],
  );

  return { handleRefresh, handleExpandDir };
}
