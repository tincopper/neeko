import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Undo2, ListPlus } from '@/shared/components/icons';
import type { FileChange } from '@/shared/types';

import { useUntrackedDirExpansion } from '../hooks/useUntrackedDirExpansion';

import Section from './ChangesSection';

interface ChangesListProps {
  files: FileChange[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onDiscardFile: (path: string) => void;
  onDiscardAll?: () => void;
  onStageFile?: (path: string) => void;
  onStageAllUntracked?: () => void;
  onFileSelect?: (path: string) => void;
  /**
   * 展开折叠的 untracked 目录条目（后端 `git status` 折叠语义，条目 path 带尾斜杠）：
   * 返回目录下的 untracked 文件相对路径列表。缺省时目录条目退化为纯展示行。
   */
  onExpandUntrackedDir?: (dirPath: string) => Promise<string[]>;
  loading: boolean;
}

type FilterStatus = 'all' | 'Modified' | 'Added' | 'Deleted' | 'Renamed';

const STATUS_LABELS: Record<FilterStatus, string> = {
  all: 'All',
  Modified: 'M',
  Added: 'A',
  Deleted: 'D',
  Renamed: 'R',
};

const ChangesList: React.FC<ChangesListProps> = ({
  files,
  selectedFiles,
  onToggleFile,
  onDiscardFile,
  onDiscardAll,
  onStageFile,
  onStageAllUntracked,
  onFileSelect,
  onExpandUntrackedDir,
  loading,
}) => {
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [unversionedExpanded, setUnversionedExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const trackedFiles = useMemo(() => files.filter((f) => f.status !== 'Untracked'), [files]);

  // 折叠 untracked 目录条目 → 平铺为文件行（按需拉取 + 占位，见 useUntrackedDirExpansion）
  const { flattenedUntracked } = useUntrackedDirExpansion(files, onExpandUntrackedDir);

  const filteredTrackedFiles = useMemo(() => {
    if (filter === 'all') return trackedFiles;
    return trackedFiles.filter((f) => f.status === filter);
  }, [trackedFiles, filter]);

  const trackedAdd = trackedFiles.reduce((s, f) => s + f.additions, 0);
  const trackedDel = trackedFiles.reduce((s, f) => s + f.deletions, 0);

  const isAllSelected = useCallback(
    (fileList: FileChange[]) =>
      fileList.length > 0 && fileList.every((f) => selectedFiles.has(f.path)),
    [selectedFiles],
  );

  const handleSelectGroup = useCallback(
    (fileList: FileChange[]) => {
      const allSel = isAllSelected(fileList);
      if (allSel) {
        fileList.forEach((f) => {
          if (selectedFiles.has(f.path)) onToggleFile(f.path);
        });
      } else {
        fileList.forEach((f) => {
          if (!selectedFiles.has(f.path)) onToggleFile(f.path);
        });
      }
    },
    [isAllSelected, selectedFiles, onToggleFile],
  );

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--font-size)] text-text-muted py-4">No changes</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      {/* ── Changes (tracked files) ── */}
      {trackedFiles.length > 0 && (
        <Section
          title="Changes"
          count={trackedFiles.length}
          additions={trackedAdd}
          deletions={trackedDel}
          expanded={changesExpanded}
          onToggle={() => setChangesExpanded((v) => !v)}
          files={filteredTrackedFiles}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(filteredTrackedFiles)}
          onSelectAll={() => handleSelectGroup(filteredTrackedFiles)}
          onToggleFile={onToggleFile}
          onFileSelect={onFileSelect}
          onDiscardFile={onDiscardFile}
          loading={loading}
          filter={
            <div className="flex items-center gap-1">
              {(['all', 'Modified', 'Added', 'Deleted', 'Renamed'] as FilterStatus[]).map((s) => (
                <button
                  key={s}
                  className={cn(
                    'text-[calc(var(--font-size)-2px)] px-1.5 py-0.5 rounded transition-colors duration-100',
                    filter === s
                      ? 'bg-bg-tertiary text-text-primary'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                  onClick={() => setFilter(s)}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          }
          headerAction={
            onDiscardAll && (
              <button
                className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100"
                title="Discard all changes"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscardAll();
                }}
                disabled={loading}
              >
                <Undo2 size={14} />
              </button>
            )
          }
        />
      )}

      {/* ── Unversioned (untracked files) ── */}
      {flattenedUntracked.length > 0 && (
        <Section
          title="Unversioned"
          count={flattenedUntracked.length}
          expanded={unversionedExpanded}
          onToggle={() => setUnversionedExpanded((v) => !v)}
          files={flattenedUntracked}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(flattenedUntracked)}
          onSelectAll={() => handleSelectGroup(flattenedUntracked)}
          onToggleFile={onToggleFile}
          onFileSelect={onFileSelect}
          onDiscardFile={onDiscardFile}
          onStageFile={onStageFile}
          loading={loading}
          headerAction={
            onStageAllUntracked && (
              <button
                className="p-0.5 rounded text-text-muted hover:text-accent-green hover:bg-bg-hover transition-colors duration-100"
                title="Stage all unversioned files"
                onClick={(e) => {
                  e.stopPropagation();
                  onStageAllUntracked();
                }}
                disabled={loading}
              >
                <ListPlus size={14} />
              </button>
            )
          }
        />
      )}
    </div>
  );
};

export default React.memo(ChangesList);
