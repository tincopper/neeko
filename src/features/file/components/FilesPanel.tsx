import React, { useCallback, useEffect, useRef } from 'react';

import ContextMenu from '@/shared/components/ContextMenu';
import type { FileNode, FileChange } from '@/shared/types';

import { useFilePanelState } from '../hooks/useFilePanelState';
import { displayHomePath } from '../utils/fileTreeUtils';

import DeleteConfirmDialog from './DeleteConfirmDialog';
import FilesPanelHeader from './FilesPanelHeader';
import FileTreeNode from './FileTreeNode';
import InlineNameInput from './InlineNameInput';

export { displayHomePath };

interface FilesPanelProps {
  projectName: string | null;
  projectPath?: string | null;
  /** 项目 ID — 用于拖拽文件时传给 sendToAgent */
  projectId: string | null;
  fileTree: FileNode[];
  isLoading: boolean;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
  /** 懒加载：按需加载超过初始深度的子目录 */
  onExpandDir: (dirPath: string) => Promise<void>;
  /** 项目类型 */
  projectType?: 'Local' | 'Wsl' | 'Remote' | null;
  /** 在 Browser Dock Panel 中打开 HTML 文件 */
  onOpenInBrowser?: (filePath: string) => void;
  /** 用系统默认浏览器打开 HTML 文件 */
  onOpenInSystemBrowser?: (filePath: string) => void;
  /** 在系统文件管理器中显示 */
  onRevealInExplorer?: (filePath: string) => void;
  /** git 变更文件列表（用于文件名着色） */
  changedFiles?: FileChange[];
  /** 新建文件（dirPath 为相对根的目录，'' 表示根目录） */
  onCreateFile?: (dirPath: string, name: string) => Promise<void> | void;
  /** 新建目录 */
  onCreateDirectory?: (dirPath: string, name: string) => Promise<void> | void;
  /** 删除文件或目录 */
  onDeletePath?: (path: string, isDir: boolean) => Promise<void> | void;
  /** 重命名文件或目录（同目录内改名） */
  onRenamePath?: (path: string, newName: string) => Promise<void> | void;
  /** 被 .gitignore 忽略的相对路径列表（文件树灰色显示） */
  ignoredFiles?: string[];
  /** 定位目标：当前激活 file tab 的路径（null 表示无 file tab） */
  locateTargetPath?: string | null;
  /** 当前是否有 file tab 打开（无则按钮置灰） */
  canLocateFile?: boolean;
  /** 切换 file tab 时是否自动定位（默认开启；关闭后仅按钮可手动定位） */
  autoLocateFileOnTabSwitch?: boolean;
}

function FilesPanel({
  projectName,
  projectPath,
  projectId,
  fileTree,
  isLoading,
  activeFilePath,
  onSelectFile,
  onRefresh,
  onExpandDir,
  projectType,
  onOpenInBrowser,
  onOpenInSystemBrowser,
  onRevealInExplorer,
  onCreateFile,
  onCreateDirectory,
  onDeletePath,
  onRenamePath,
  ignoredFiles,
  changedFiles,
  locateTargetPath,
  canLocateFile,
  autoLocateFileOnTabSwitch = true,
}: FilesPanelProps) {
  const state = useFilePanelState({
    projectPath,
    fileTree,
    activeFilePath,
    onSelectFile,
    onRefresh,
    onExpandDir,
    projectType,
    onOpenInBrowser,
    onOpenInSystemBrowser,
    onRevealInExplorer,
    onCreateFile,
    onCreateDirectory,
    onDeletePath,
    onRenamePath,
    changedFiles,
    ignoredFiles,
  });

  // 定位：复用「点击选中」同一流程（selectedNode → isSelected 高亮 + 展开父目录）。
  // 与手动点击文件的选中/滚动完全一致，不单独维护一套高亮。
  const { locateFile } = state;
  const handleLocateFile = useCallback(() => {
    if (locateTargetPath) {
      locateFile(locateTargetPath);
    }
  }, [locateTargetPath, locateFile]);

  // 切换 file tab（locateTargetPath 变化）时自动定位 —— 与点击定位按钮走同一
  // 选中流程。用 ref 记住上一次目标，避免每次渲染重复定位。
  // 关闭 autoLocateFileOnTabSwitch 后不做自动定位（按钮仍可手动定位）。
  const prevLocateTargetRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (
      autoLocateFileOnTabSwitch &&
      locateTargetPath &&
      locateTargetPath !== prevLocateTargetRef.current
    ) {
      locateFile(locateTargetPath);
    }
    prevLocateTargetRef.current = locateTargetPath;
  }, [autoLocateFileOnTabSwitch, locateTargetPath, locateFile]);

  if (!projectName) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          Select a project to browse files
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <FilesPanelHeader
        projectName={projectName}
        projectPath={projectPath}
        activeFileName={state.activeFileName}
        activeFilePath={activeFilePath}
        displayPath={state.displayPath}
        onCreateFile={
          onCreateFile ? () => state.startCreating(state.getCreationDir(), 'file') : undefined
        }
        onCreateDirectory={
          onCreateDirectory ? () => state.startCreating(state.getCreationDir(), 'dir') : undefined
        }
        onCollapseAll={state.collapseAll}
        canCollapse={state.canCollapse}
        onRefresh={state.handleRefresh}
        onLocateFile={handleLocateFile}
        canLocateFile={canLocateFile}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {/* 新建输入行放在树列表第一个位置 */}
        {state.creating && state.creating.dirPath === '' && (
          <InlineNameInput
            kind={state.creating.kind}
            value={state.creatingValue}
            onChange={state.setCreatingValue}
            onSubmit={state.submitCreating}
            onCancel={state.cancelCreating}
            indent={4}
          />
        )}
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-[var(--font-size)] text-text-secondary">Loading...</span>
          </div>
        ) : fileTree.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-[var(--font-size)] text-text-secondary">No files found</span>
          </div>
        ) : (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              expandedDirs={state.expandedDirs}
              loadingDirs={state.loadingDirs}
              projectId={projectId}
              onSelectFile={onSelectFile}
              onToggleDir={state.handleToggleDir}
              onContextMenu={state.handleContextMenu}
              onSelectNode={state.handleSelectNode}
              selectedPath={state.selectedNode?.path ?? null}
              creating={state.creating}
              creatingValue={state.creatingValue}
              onCreatingValueChange={state.setCreatingValue}
              onCreatingSubmit={state.submitCreating}
              onCreatingCancel={state.cancelCreating}
              renaming={state.renaming}
              onRenamingChange={state.handleRenamingChange}
              onRenamingSubmit={state.submitRenaming}
              onRenamingCancel={state.cancelRenaming}
              changedFilesMap={state.changedFilesMap}
              ignoredSet={state.ignoredSet}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {state.contextMenu && (
        <ContextMenu
          items={state.buildContextMenuItems(state.contextMenu.node)}
          position={state.contextMenu.position}
          onClose={state.closeContextMenu}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        target={state.confirmDelete}
        onCancel={state.closeDeleteConfirm}
        onConfirm={(path, isDir) => {
          state.closeDeleteConfirm();
          void state.handleDelete(path, isDir);
        }}
      />
    </div>
  );
}

export default React.memo(FilesPanel);
