import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import ContextMenu from '@/shared/components/ContextMenu';
import type { FileChange } from '@/shared/types';
import { buildFileTreeView, flattenFileTreeView } from '@/shared/utils/fileTree';
import {
  buildFileSummaryMap,
  buildFolderSummaryMap,
  collectCollapsedDirs,
  resolveNodeStatus,
} from '@/shared/utils/gitFileDecoration';

import { useFilePanelState } from '../hooks/useFilePanelState';
import { useFileStore } from '../store';
import { displayHomePath } from '../utils/fileTreeUtils';

import DeleteConfirmDialog from './DeleteConfirmDialog';
import FilesPanelHeader from './FilesPanelHeader';
import FileTreeList from './FileTreeList';
import InlineNameInput from './InlineNameInput';

export { displayHomePath };

/** 空变更列表常量：避免每次渲染新建空数组导致下游 useMemo 依赖抖动 */
const EMPTY_CHANGED_FILES: FileChange[] = [];

interface FilesPanelProps {
  projectName: string | null;
  projectPath?: string | null;
  /** 项目 ID — 用于拖拽文件时传给 sendToAgent */
  projectId: string | null;
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
  /** git 变更文件列表（装饰投影输入：着色 + 目录聚合徽标） */
  changedFiles?: FileChange[];
  /** 新建文件（dirPath 为相对根的目录，'' 表示根目录） */
  onCreateFile?: (dirPath: string, name: string) => Promise<void> | void;
  /** 新建目录 */
  onCreateDirectory?: (dirPath: string, name: string) => Promise<void> | void;
  /** 删除文件或目录 */
  onDeletePath?: (path: string, isDir: boolean) => Promise<void> | void;
  /** 重命名文件或目录（同目录内改名） */
  onRenamePath?: (path: string, newName: string) => Promise<void> | void;
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
  locateTargetPath,
  canLocateFile,
  autoLocateFileOnTabSwitch = true,
}: FilesPanelProps) {
  const dirs = useFileStore((s) => s.dirs);
  const loadStates = useFileStore((s) => s.loadStates);
  const state = useFilePanelState({
    projectPath,
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
  });

  // ── 装饰投影（S3：组装期 join）────────────────────────────
  // git 变更/忽略输入 → 路径摘要 map（输入不变则引用不变）
  const fileSummaries = useMemo(
    () => buildFileSummaryMap(changedFiles ?? EMPTY_CHANGED_FILES),
    [changedFiles],
  );
  // 折叠 untracked 目录条目：后代继承目录态色的投影输入（Rust 不递归 untracked）。
  // G1 起目录条目为无尾斜杠 path + is_dir；collectCollapsedDirs 产物同时喂给
  // folderSummaries（目录自身需显式携带状态色）与 resolveNodeStatus。
  const collapsedDirs = useMemo(
    () => collectCollapsedDirs(changedFiles ?? EMPTY_CHANGED_FILES),
    [changedFiles],
  );
  const folderSummaries = useMemo(
    () => buildFolderSummaryMap(fileSummaries, collapsedDirs),
    [fileSummaries, collapsedDirs],
  );
  // S5：ignored 灰显不再来自平行数组 —— 后端读层原生标注 node.ignored，
  // 组装期并入 is_ignored（见 fileTree.ts finalizeNode）。

  // 组装期 join：buildFileTreeView 的 decorate 回调把语义状态（主导状态 + ignored
  // 原始事实）直接盖章到视图节点——FileTreeRow 读字段呈现，无渲染期匹配回调。
  const decorate = useCallback(
    (path: string, isDir: boolean) =>
      resolveNodeStatus(path, isDir, { fileSummaries, folderSummaries, collapsedDirs }),
    [fileSummaries, folderSummaries, collapsedDirs],
  );

  // 视图树：组装期 join（git 投影 + 逐节点视图状态统一盖章）。
  // 已展开目录内容来自各自缓存，根刷新不影响子树。
  const viewTree = useMemo(
    () =>
      buildFileTreeView(
        dirs,
        state.expandedDirs,
        {
          activeFilePath,
          selectedPath: state.selectedNode?.path ?? null,
          dirLoadStates: loadStates,
          creating: state.creating,
          creatingValue: state.creatingValue,
          renaming: state.renaming,
        },
        decorate,
      ),
    [
      dirs,
      state.expandedDirs,
      activeFilePath,
      loadStates,
      state.selectedNode,
      state.creating,
      state.creatingValue,
      state.renaming,
      decorate,
    ],
  );

  // S4：视图树 → 扁平行（按渲染顺序），交 FileTreeList 窗口化渲染（O(可见行数)）。
  // 定位滚动（scrollToIndex）由 FileTreeList 收口。
  const rows = useMemo(() => flattenFileTreeView(viewTree), [viewTree]);
  const selectedPath = state.selectedNode?.path ?? null;

  // 首次加载（根无内容且 loading）显示全面板 Loading；失败且无内容显示重试
  const isLoading = loadStates[''] === 'loading' && !dirs[''];
  const loadFailed = loadStates[''] === 'error' && !dirs[''];

  // 定位：复用「点击选中」同一流程（selectedNode → isSelected 高亮 + 展开父目录）。
  // 与手动点击文件的选中/滚动完全一致，不单独维护一套高亮。
  const { locateFile } = state;
  const handleLocateFile = useCallback(() => {
    if (locateTargetPath) {
      void locateFile(locateTargetPath);
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
      void locateFile(locateTargetPath);
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

      {/* 新建输入行放在树列表第一个位置（根目录级，位于滚动区外） */}
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
      {/* 树列表：loading / error / empty 三态 + 虚拟化渲染 + 定位滚动（FileTreeList 收口） */}
      <FileTreeList
        rows={rows}
        selectedPath={selectedPath}
        isLoading={isLoading}
        loadFailed={loadFailed}
        projectId={projectId}
        onSelectFile={onSelectFile}
        onToggleDir={state.handleToggleDir}
        onRetryDir={onExpandDir}
        onRefresh={onRefresh}
        onContextMenu={state.handleContextMenu}
        onSelectNode={state.handleSelectNode}
        onCreatingValueChange={state.setCreatingValue}
        onCreatingSubmit={state.submitCreating}
        onCreatingCancel={state.cancelCreating}
        onRenamingChange={state.handleRenamingChange}
        onRenamingSubmit={state.submitRenaming}
        onRenamingCancel={state.cancelRenaming}
      />

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
