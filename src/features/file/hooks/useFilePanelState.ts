import { homeDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ContextMenuItem } from '@/shared/components/ContextMenu';
import {
  Globe,
  FolderOpen,
  FileText,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Copy,
  ClipboardCopy,
  ExternalLink,
} from '@/shared/components/icons';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { FileNode, FileChange } from '@/shared/types';
import { resolveAbsolutePath } from '@/shared/utils/browserUtils';

import { displayHomePath, getParentPath, getParentPaths } from '../utils/fileTreeUtils';

export interface UseFilePanelStateParams {
  projectPath?: string | null;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
  onExpandDir: (dirPath: string) => Promise<void>;
  projectType?: 'Local' | 'Wsl' | 'Remote' | null;
  onOpenInBrowser?: (filePath: string) => void;
  onOpenInSystemBrowser?: (filePath: string) => void;
  onRevealInExplorer?: (filePath: string) => void;
  onCreateFile?: (dirPath: string, name: string) => Promise<void> | void;
  onCreateDirectory?: (dirPath: string, name: string) => Promise<void> | void;
  onDeletePath?: (path: string, isDir: boolean) => Promise<void> | void;
  onRenamePath?: (path: string, newName: string) => Promise<void> | void;
  changedFiles?: FileChange[];
  ignoredFiles?: string[];
}

/**
 * FilesPanel 的全部状态与事件处理逻辑。
 * 将 UI 渲染层与 Tauri 数据交互彻底解耦（维度 10）。
 */
export function useFilePanelState(params: UseFilePanelStateParams) {
  const {
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
    changedFiles,
    ignoredFiles,
  } = params;

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const prevActiveFilePathRef = useRef<string | null>(null);
  // 用户 home 目录（用于路径展示时替换为 ~）
  const [homeDirPath, setHomeDirPath] = useState('');
  const copyToClipboard = useCopyToClipboard();

  useEffect(() => {
    let cancelled = false;
    homeDir()
      .then((h) => {
        if (!cancelled) setHomeDirPath(h);
      })
      .catch(() => {
        /* 获取失败时保持完整路径展示 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 展示用路径：非 Windows 平台下将 home 前缀替换为 ~（tooltip 仍显示完整路径）
  const displayPath = useMemo(() => {
    if (!projectPath) return null;
    const isWindows = /win/i.test(navigator.userAgent);
    return displayHomePath(projectPath, homeDirPath, isWindows);
  }, [projectPath, homeDirPath]);

  // git 变更文件路径与 status 映射（用于文件名着色）
  const changedFilesMap = useMemo(() => {
    if (!changedFiles || changedFiles.length === 0) return undefined;
    return new Map(changedFiles.map((f) => [f.path, f.status]));
  }, [changedFiles]);
  // .gitignore 忽略路径集合（灰色显示）
  const ignoredSet = useMemo(() => {
    if (!ignoredFiles || ignoredFiles.length === 0) return undefined;
    return new Set(ignoredFiles);
  }, [ignoredFiles]);

  // 右键上下文菜单状态
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    node: FileNode;
  } | null>(null);
  // 新建文件/目录内联输入状态
  const [creating, setCreating] = useState<{ dirPath: string; kind: 'file' | 'dir' } | null>(null);
  const [creatingValue, setCreatingValue] = useState('');
  // 当前选中节点（用于 Delete 按钮）
  const [selectedNode, setSelectedNode] = useState<{ path: string; isDir: boolean } | null>(null);
  // 待确认删除的节点（弹出确认对话框）
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; isDir: boolean } | null>(null);
  // 重命名状态（path + 当前名）
  const [renaming, setRenaming] = useState<{ path: string; isDir: boolean; name: string } | null>(
    null,
  );

  // 刷新：展开状态保留（内容刷新由 store.loadDir 幂等处理）
  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  // 展开目标文件的所有父目录（定位/打开文件共用）。返回是否有新增展开。
  const expandPathParents = useCallback((filePath: string): boolean => {
    const parentPaths = getParentPaths(filePath);
    let hasNew = false;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const p of parentPaths) {
        if (!next.has(p)) {
          next.add(p);
          hasNew = true;
        }
      }
      return hasNew ? next : prev;
    });
    return hasNew;
  }, []);

  // Auto-expand parent directories when activeFilePath changes
  useEffect(() => {
    if (activeFilePath && activeFilePath !== prevActiveFilePathRef.current) {
      expandPathParents(activeFilePath);
      prevActiveFilePathRef.current = activeFilePath;
    }
  }, [activeFilePath, expandPathParents]);

  const handleToggleDir = useCallback(
    async (path: string) => {
      // 收起：直接 toggle，无需加载
      if (expandedDirs.has(path)) {
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        return;
      }

      // 展开：先展开（内容由扁平缓存 + loadStates 驱动），再触发懒加载。
      // store.loadDir 幂等：已 loaded/loading 跳过，idle/error 发起请求；
      // 失败由 store 置 error 态（红点提示，可重试），不再由面板折叠目录。
      setExpandedDirs((prev) => new Set(prev).add(path));
      await onExpandDir(path);
    },
    [expandedDirs, onExpandDir],
  );

  // 右键菜单处理
  const handleContextMenu = useCallback((position: { x: number; y: number }, node: FileNode) => {
    setSelectedNode({ path: node.path, isDir: node.is_dir });
    setContextMenu({ position, node });
  }, []);

  // 折叠全部：一键收起所有已展开目录
  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleSelectNode = useCallback((path: string, isDir: boolean) => {
    setSelectedNode({ path, isDir });
  }, []);

  // 定位：复用「点击选中」逻辑（selectedNode → selectedPath → isSelected 高亮），
  // 额外展开父目录。与手动点击文件的选中路径完全一致，不另起一套高亮。
  const locateFile = useCallback(
    (path: string) => {
      handleSelectNode(path, false);
      expandPathParents(path);
    },
    [handleSelectNode, expandPathParents],
  );

  // 关闭删除确认对话框（不执行删除）
  const closeDeleteConfirm = useCallback(() => {
    setConfirmDelete(null);
  }, []);

  // 新建目标的默认目录：选中目录 → 该目录内；选中文件 → 其所在目录；未选中 → 根目录
  const getCreationDir = useCallback(() => {
    if (!selectedNode) return '';
    return selectedNode.isDir ? selectedNode.path : getParentPath(selectedNode.path);
  }, [selectedNode]);

  // 开始新建：在指定目录（'' 为根）内联输入名称
  const startCreating = useCallback((dirPath: string, kind: 'file' | 'dir') => {
    setCreating({ dirPath, kind });
    setCreatingValue('');
    // 在目录内新建时自动展开该目录，让内联输入行可见
    if (dirPath) {
      setExpandedDirs((prev) => new Set(prev).add(dirPath));
    }
  }, []);

  const submitCreating = useCallback(async () => {
    if (!creating) return;
    const name = creatingValue.trim();
    if (!name) return;
    const { dirPath, kind } = creating;
    setCreating(null);
    setCreatingValue('');
    try {
      if (kind === 'file') {
        await onCreateFile?.(dirPath, name);
      } else {
        await onCreateDirectory?.(dirPath, name);
      }
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: kind === 'file' ? 'New File' : 'New Folder',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [creating, creatingValue, onCreateFile, onCreateDirectory]);

  const cancelCreating = useCallback(() => {
    setCreating(null);
    setCreatingValue('');
  }, []);

  const handleDelete = useCallback(
    async (path: string, isDir: boolean) => {
      try {
        await onDeletePath?.(path, isDir);
        setSelectedNode(null);
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Delete',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [onDeletePath],
  );

  const handleRenamingChange = useCallback((value: string) => {
    setRenaming((prev) => (prev ? { ...prev, name: value } : prev));
  }, []);

  const submitRenaming = useCallback(async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const { path, isDir } = renaming;
    const oldName = path.split('/').pop() ?? path;
    // 名字为空或未变化：直接退出编辑
    if (!name || name === oldName) {
      setRenaming(null);
      return;
    }
    setRenaming(null);
    try {
      await onRenamePath?.(path, name);
      // 重命名成功后选中节点更新为新路径
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      setSelectedNode({ path: parent ? `${parent}/${name}` : name, isDir });
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Rename',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [renaming, onRenamePath]);

  const cancelRenaming = useCallback(() => {
    setRenaming(null);
  }, []);

  // 构建上下文菜单项
  const buildContextMenuItems = useCallback(
    (node: FileNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const isHtmlFile = !node.is_dir && /\.(html|htm)$/i.test(node.name);

      if (!node.is_dir) {
        items.push({
          label: 'Open in Editor',
          icon: FileText,
          action: () => onSelectFile(node.path),
        });
      }

      if (isHtmlFile && projectType === 'Local') {
        if (onOpenInBrowser) {
          items.push({
            label: 'Open in App Browser',
            icon: Globe,
            action: () => onOpenInBrowser(node.path),
          });
        }
        if (onOpenInSystemBrowser) {
          items.push({
            label: 'Open in System Browser',
            icon: ExternalLink,
            action: () => onOpenInSystemBrowser(node.path),
          });
        }
      }

      items.push({ separator: true });

      items.push({
        label: 'Copy Path',
        icon: Copy,
        action: () => {
          const absPath = projectPath ? resolveAbsolutePath(projectPath, node.path) : node.path;
          void copyToClipboard(absPath, 'path');
        },
      });

      if (projectPath) {
        items.push({
          label: 'Copy Relative Path',
          icon: ClipboardCopy,
          // node.path 已经是相对于项目根的相对路径，直接复制
          action: () => {
            void copyToClipboard(node.path, 'path');
          },
        });
      }

      if (projectType === 'Local' && onRevealInExplorer) {
        items.push({ separator: true });
        items.push({
          label: 'Reveal in File Manager',
          icon: FolderOpen,
          action: () => onRevealInExplorer(node.path),
        });
      }

      // 文件/目录创建与删除（右键方式）
      if (onCreateFile || onCreateDirectory) {
        items.push({ separator: true });
        const targetDir = node.is_dir ? node.path : getParentPath(node.path);
        if (onCreateFile) {
          items.push({
            label: 'New File',
            icon: FilePlus,
            action: () => startCreating(targetDir, 'file'),
          });
        }
        if (onCreateDirectory) {
          items.push({
            label: 'New Folder',
            icon: FolderPlus,
            action: () => startCreating(targetDir, 'dir'),
          });
        }
      }
      if (onRenamePath) {
        items.push({ separator: true });
        items.push({
          label: 'Rename',
          icon: Pencil,
          action: () => setRenaming({ path: node.path, isDir: node.is_dir, name: node.name }),
        });
      }
      if (onDeletePath) {
        items.push({ separator: true });
        items.push({
          label: 'Delete',
          icon: Trash2,
          action: () => setConfirmDelete({ path: node.path, isDir: node.is_dir }),
        });
      }

      return items;
    },
    [
      projectType,
      projectPath,
      onSelectFile,
      onOpenInBrowser,
      onOpenInSystemBrowser,
      onRevealInExplorer,
      onCreateFile,
      onCreateDirectory,
      onDeletePath,
      onRenamePath,
      startCreating,
      copyToClipboard,
    ],
  );

  // 当前打开的文件名（用于头部展示）
  const activeFileName = activeFilePath
    ? activeFilePath.split(/[\\/]/).pop() || activeFilePath
    : null;

  return {
    expandedDirs,
    displayPath,
    changedFilesMap,
    ignoredSet,
    contextMenu,
    creating,
    creatingValue,
    setCreatingValue,
    selectedNode,
    confirmDelete,
    renaming,
    activeFileName,
    handleRefresh,
    handleToggleDir,
    handleContextMenu,
    collapseAll,
    closeContextMenu,
    handleSelectNode,
    locateFile,
    getCreationDir,
    startCreating,
    submitCreating,
    cancelCreating,
    handleDelete,
    closeDeleteConfirm,
    handleRenamingChange,
    submitRenaming,
    cancelRenaming,
    buildContextMenuItems,
    canCollapse: expandedDirs.size > 0,
  };
}
