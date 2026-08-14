import React, { useCallback, useMemo } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { useFileActionsContext } from '@/features/editor';
import { FilesPanel, useFileTreeSync, useLocateFileInTree } from '@/features/file';
import {
  createDirectory,
  createNewFile,
  deletePath,
  renamePath,
  revealInFileManager,
} from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { refreshGitFileStates } from '@/features/git';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { useDockStore } from '@/shared/store/dockStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  filePathToFileUrl,
  openHtmlInBrowserPanel,
  resolveAbsolutePath,
} from '@/shared/utils/browserUtils';
import { resolveTabKey } from '@/shared/utils/tabKey';

/**
 * Files dock 面板适配层：读取 file context + store 并透传给 FilesPanel。
 * 目录加载/刷新/展开/事件刷新编排由 useFileTreeSync 承担（feature hook），
 * 本层只做 dock 适配（isActive）与文件 CRUD / 浏览器打开等展示侧动作。
 */
const FilesPanelWrapper: React.FC = React.memo(() => {
  const { onFileSelect, onFileRefresh, onLoadFileTree, onExpandDir } = useFileActionsContext();
  const { project, commands, worktreePath } = useActiveProject();
  const { config, showToast } = useAppContext();
  const projectName = project?.name ?? null;
  const fileRootPath = worktreePath ?? project?.path ?? null;
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectPath = fileRootPath;
  const changedFiles = project?.gitInfo?.changed_files;
  // 定位当前编辑器 file tab 到文件树（复用面板内「点击选中」逻辑）
  const tabKey = project ? resolveTabKey(project.id, worktreePath) : '';
  const { canLocateFile, filePath: locateTargetPath } = useLocateFileInTree(tabKey);
  // 稳定引用：`?? []` 每次渲染生成新数组，会令下游 effect/callback 依赖抖动
  const ignoredFiles = useMemo(
    () => project?.gitInfo?.ignored_files ?? [],
    [project?.gitInfo?.ignored_files],
  );

  // Compute projectId for use by child components (drag-and-drop, etc.)
  const projectId = project ? (project.type === 'Local' ? activeProjectId : project.id) : null;

  // 面板在 dock 中激活（任一 zone 激活且展开）才发起首次加载
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'files' && zone.expanded) return true;
    }
    return false;
  });

  // 目录加载 / file-tree-changed 事件刷新 / 手动刷新 / 懒加载展开（feature hook）
  const { handleRefresh, handleExpandDir } = useFileTreeSync({
    project,
    commands,
    activeProjectId,
    fileRootPath,
    ignoredFiles,
    isActive,
    onLoadFileTree,
    onFileRefresh,
    onExpandDir,
  });

  // 在 Browser Panel 中打开 HTML 文件（仅本地项目）
  // filePath 是相对于项目根的路径，需要拼接为绝对路径
  const handleOpenInBrowser = useCallback(
    (filePath: string) => {
      if (project?.type === 'Local' && projectPath) {
        openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, filePath));
      }
    },
    [project?.type, projectPath],
  );

  // 用系统默认浏览器打开 HTML 文件
  const handleOpenInSystemBrowser = useCallback(
    (filePath: string) => {
      if (project?.type === 'Local' && projectPath) {
        const absPath = resolveAbsolutePath(projectPath, filePath);
        const fileUrl = filePathToFileUrl(absPath);
        openInDefaultBrowser(fileUrl, project.id).catch((err) => {
          console.error('[FilesPanelWrapper] Failed to open in system browser:', err);
          showToast('Failed to open in system browser', 'error');
        });
      }
    },
    [project, projectPath, showToast],
  );

  // 在系统文件管理器中显示文件（确保传绝对路径）
  const handleRevealInExplorer = useCallback(
    (filePath: string) => {
      const absPath = projectPath ? resolveAbsolutePath(projectPath, filePath) : filePath;
      revealInFileManager(absPath).catch((err) => {
        console.error('[FilesPanelWrapper] Failed to reveal in file manager:', err);
      });
    },
    [projectPath],
  );

  // 新建文件/目录/删除：统一走 file 域命令，root 使用 worktree 或项目根
  // 错误向上抛给 FilesPanel 处理（弹通知），成功后静默刷新目录树
  const handleCreate = useCallback(
    async (dirPath: string, name: string, kind: 'file' | 'dir') => {
      if (!projectId) return;
      const relPath = dirPath ? `${dirPath}/${name}` : name;
      if (kind === 'file') {
        await createNewFile(projectId, relPath, fileRootPath ?? null);
      } else {
        await createDirectory(projectId, relPath, fileRootPath ?? null);
      }
      handleRefresh();
      // watcher 只监听主项目路径，worktree 内新建文件不会自动刷新 git 状态，
      // 显式刷新 changed_files 使新文件立即着色（Untracked）
      void refreshGitFileStates(projectId, worktreePath ?? '');
    },
    [projectId, fileRootPath, handleRefresh, worktreePath],
  );

  const handleCreateFile = useCallback(
    (dirPath: string, name: string) => handleCreate(dirPath, name, 'file'),
    [handleCreate],
  );

  const handleCreateDirectory = useCallback(
    (dirPath: string, name: string) => handleCreate(dirPath, name, 'dir'),
    [handleCreate],
  );

  const handleDeletePath = useCallback(
    async (path: string) => {
      if (!projectId) return;
      await deletePath(projectId, path, fileRootPath ?? null);
      handleRefresh();
      void refreshGitFileStates(projectId, worktreePath ?? '');
    },
    [projectId, fileRootPath, handleRefresh, worktreePath],
  );

  const handleRenamePath = useCallback(
    async (path: string, newName: string) => {
      if (!projectId) return;
      await renamePath(projectId, path, newName, fileRootPath ?? null);
      handleRefresh();
      void refreshGitFileStates(projectId, worktreePath ?? '');
    },
    [projectId, fileRootPath, handleRefresh, worktreePath],
  );

  return (
    <FilesPanel
      projectName={projectName}
      projectPath={projectPath}
      projectId={projectId}
      activeFilePath={activeFilePath}
      onSelectFile={onFileSelect}
      onRefresh={handleRefresh}
      onExpandDir={handleExpandDir}
      projectType={project?.type ?? null}
      onOpenInBrowser={handleOpenInBrowser}
      onOpenInSystemBrowser={handleOpenInSystemBrowser}
      onRevealInExplorer={handleRevealInExplorer}
      onCreateFile={handleCreateFile}
      onCreateDirectory={handleCreateDirectory}
      onDeletePath={handleDeletePath}
      onRenamePath={handleRenamePath}
      changedFiles={changedFiles}
      ignoredFiles={ignoredFiles}
      locateTargetPath={locateTargetPath}
      canLocateFile={canLocateFile}
      autoLocateFileOnTabSwitch={config.autoLocateFileOnTabSwitch}
    />
  );
});
FilesPanelWrapper.displayName = 'FilesPanelWrapper';

export default FilesPanelWrapper;
export { FilesPanelWrapper };
