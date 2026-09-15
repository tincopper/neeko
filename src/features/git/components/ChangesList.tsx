import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Undo2, ListPlus } from '@/shared/components/icons';
import type { FileChange } from '@/shared/types';

import { useUntrackedDirExpansion } from '../hooks/useUntrackedDirExpansion';
import { buildGitStatusGroups } from '../utils/gitStatusGroups';

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
  /** 在编辑器中打开该文件（Open File 快捷跳转）；透传给各 Section */
  onOpenFile?: (path: string) => void;
  /**
   * 展开折叠的 untracked 目录条目（后端 `git status` 折叠语义，条目 path 带尾斜杠）：
   * 返回目录下的 untracked 文件相对路径列表。缺省时目录条目退化为纯展示行。
   */
  onExpandUntrackedDir?: (dirPath: string) => Promise<string[]>;
  loading: boolean;
  /** G4（P3 截断显式化）：快照超过 MAX_STATUS_ENTRIES 被截断时顶部显示提示 */
  truncated?: boolean;
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
  onOpenFile,
  onExpandUntrackedDir,
  loading,
  truncated = false,
}) => {
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [unversionedExpanded, setUnversionedExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');

  // G6 简化契约：tracked（staged/unstaged/conflicted 合并）与 unversioned 两组
  // （纯派生，无独立状态；缺 XY 的旧 payload 回退：Untracked → unversioned，其余 → tracked）
  const groups = useMemo(() => buildGitStatusGroups(files), [files]);

  // 折叠 untracked 目录条目 → 平铺为文件行（按需拉取 + 占位，见 useUntrackedDirExpansion）
  const { flattenedUntracked } = useUntrackedDirExpansion(groups.unversioned, onExpandUntrackedDir);

  const filterList = useCallback(
    (list: FileChange[]) => (filter === 'all' ? list : list.filter((f) => f.status === filter)),
    [filter],
  );
  const filteredTracked = useMemo(() => filterList(groups.tracked), [groups.tracked, filterList]);

  const groupStats = (list: FileChange[]) => ({
    add: list.reduce((s, f) => s + f.additions, 0),
    del: list.reduce((s, f) => s + f.deletions, 0),
  });
  const trackedStats = groupStats(filteredTracked);

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
      {/* ── G4 截断提示（P3：截断显式化，对齐 orca too-many-changes）── */}
      {truncated && (
        <div className="px-3 py-1.5 text-[var(--font-size)] text-accent-orange bg-accent-orange/10 shrink-0">
          Change list exceeds 1000 entries and is truncated
        </div>
      )}
      {/* ── Changes（tracked：staged/unstaged/conflicted 合并；G6 简化契约）── */}
      {filteredTracked.length > 0 && (
        <Section
          title="Changes"
          count={filteredTracked.length}
          additions={trackedStats.add}
          deletions={trackedStats.del}
          expanded={changesExpanded}
          onToggle={() => setChangesExpanded((v) => !v)}
          files={filteredTracked}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(filteredTracked)}
          onSelectAll={() => handleSelectGroup(filteredTracked)}
          onToggleFile={onToggleFile}
          onFileSelect={onFileSelect}
          onDiscardFile={onDiscardFile}
          onOpenFile={onOpenFile}
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
          onOpenFile={onOpenFile}
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
