import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import ContextMenu from '@/shared/components/ContextMenu';
import { VirtualList } from '@/shared/components/VirtualList';
import type { VirtualListHandle } from '@/shared/components/VirtualList';
import type { FileChange } from '@/shared/types';
import { buildFileTreeView, flattenFileTreeView, flatRowKey } from '@/shared/utils/fileTree';
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
import FileTreeRow from './FileTreeRow';
import InlineNameInput from './InlineNameInput';

export { displayHomePath };

/** 空变更列表常量：避免每次渲染新建空数组导致下游 useMemo 依赖抖动 */
const EMPTY_CHANGED_FILES: FileChange[] = [];

/** VirtualList 首帧测量前的容器尺寸兜底（模块级常量，避免内联对象逐渲染新建） */
const INITIAL_LIST_RECT: { width: number; height: number } = { width: 600, height: 1200 };

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
  const ignoredSet = useMemo<Set<string> | undefined>(
    () => (ignoredFiles && ignoredFiles.length > 0 ? new Set(ignoredFiles) : undefined),
    [ignoredFiles],
  );

  // 组装期 join：buildFileTreeView 的 decorate 回调把语义状态（主导状态 + ignored
  // 原始事实）直接盖章到视图节点——FileTreeRow 读字段呈现，无渲染期匹配回调。
  const decorate = useCallback(
    (path: string, isDir: boolean) =>
      resolveNodeStatus(path, isDir, { fileSummaries, folderSummaries, ignoredSet, collapsedDirs }),
    [fileSummaries, folderSummaries, ignoredSet, collapsedDirs],
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

  // S4：视图树 → 扁平行（按渲染顺序），交 VirtualList 窗口化渲染（O(可见行数)）
  const rows = useMemo(() => flattenFileTreeView(viewTree), [viewTree]);

  // 定位：虚拟化后目标行可能未挂载，scrollIntoView 不可靠 —— 经 handle 滚到目标行。
  // 仅在选中目标**变化**时滚动（rows 重建不重滚，避免 git 刷新/内联击键把视口拽回
  // 选中行）；目标行已在可见窗口内时不滚（保持旧版 scrollIntoView block:'nearest'
  // 语义：下方目标贴底、上方目标贴顶，各取最小滚动）。
  const listHandleRef = useRef<VirtualListHandle | null>(null);
  const visibleRangeRef = useRef<[number, number] | null>(null);
  const prevSelectedPathRef = useRef<string | null>(null);
  const selectedPath = state.selectedNode?.path ?? null;
  useEffect(() => {
    if (!selectedPath || selectedPath === prevSelectedPathRef.current) return;
    const idx = rows.findIndex((r) => r.node.path === selectedPath);
    // 行尚未组装（祖先目录内容懒加载未到）→ 不记 prev，待 rows 到位后下一轮 effect 再滚
    if (idx < 0) return;
    prevSelectedPathRef.current = selectedPath;
    const range = visibleRangeRef.current;
    if (range && idx >= range[0] && idx < range[1]) return;
    const align = range ? (idx < range[0] ? 'start' : 'end') : 'center';
    listHandleRef.current?.scrollToIndex(idx, align);
  }, [selectedPath, rows]);

  // 首次加载（根无内容且 loading）显示全面板 Loading；失败且无内容显示重试
  const isLoading = loadStates[''] === 'loading' && !dirs[''];
  const loadFailed = loadStates[''] === 'error' && !dirs[''];

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
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <span className="text-[var(--font-size)] text-text-secondary">Loading...</span>
        </div>
      ) : loadFailed ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
          <span className="text-[var(--font-size)] text-text-secondary">Failed to load files</span>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[var(--font-size)] text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <span className="text-[var(--font-size)] text-text-secondary">No files found</span>
        </div>
      ) : (
        <VirtualList
          items={rows}
          getKey={flatRowKey}
          estimateSize={20}
          overscan={10}
          className="flex-1 min-h-0 overflow-x-hidden"
          initialRect={INITIAL_LIST_RECT}
          handleRef={listHandleRef}
          onRangeChange={(start, end) => {
            visibleRangeRef.current = [start, end];
          }}
          renderItem={(row) => (
            <FileTreeRow
              row={row}
              projectId={projectId}
              onSelectFile={onSelectFile}
              onToggleDir={state.handleToggleDir}
              onRetryDir={onExpandDir}
              onContextMenu={state.handleContextMenu}
              onSelectNode={state.handleSelectNode}
              onCreatingValueChange={state.setCreatingValue}
              onCreatingSubmit={state.submitCreating}
              onCreatingCancel={state.cancelCreating}
              onRenamingChange={state.handleRenamingChange}
              onRenamingSubmit={state.submitRenaming}
              onRenamingCancel={state.cancelRenaming}
            />
          )}
        />
      )}

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
