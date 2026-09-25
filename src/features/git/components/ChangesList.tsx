import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Undo2, ListPlus } from '@/shared/components/icons';
import type { FileChange } from '@/shared/types';

import { useUntrackedDirExpansion } from '../hooks/useUntrackedDirExpansion';
import type { DiscardIntent } from '../utils/discardIntent';
import {
  buildFileDiscardIntent,
  buildGroupDiscardIntent,
  discardTargetPhrase,
} from '../utils/discardIntent';
import { buildGitStatusGroups } from '../utils/gitStatusGroups';

import Section from './ChangesSection';

/**
 * 分组头部的 discard 按钮。
 *
 * 两个分组共用同一份实现（文案由 `discardTargetPhrase` 统一生成，避免 tooltip
 * 与确认弹窗各写一份后漂移）。按钮挂在组头 = 作用域即该组：选中优先于全组，
 * 且 tooltip 在点击前就把范围讲清楚（第一道确认），弹窗是第二道。
 */
interface GroupDiscardButtonProps {
  intent: DiscardIntent;
  disabled: boolean;
  onClick: () => void;
}

const GroupDiscardButton: React.FC<GroupDiscardButtonProps> = ({ intent, disabled, onClick }) => (
  <button
    className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100"
    title={`Discard ${discardTargetPhrase(intent)}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    disabled={disabled}
  >
    <Undo2 size={14} />
  </button>
);

interface ChangesListProps {
  files: FileChange[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  /** 统一的 discard 入口：单行 / 选中 / 整组都经由此回调，由宿主弹确认。 */
  onDiscard: (intent: DiscardIntent) => void;
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
  onDiscard,
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

  // discard 意图：纯派生（分组 × 选中），无独立状态。
  // 「选中优先于全组」与 scope 反推都在 buildGroupDiscardIntent 内，此处只绑定分组。
  const trackedDiscardIntent = useMemo(
    () => buildGroupDiscardIntent(filteredTracked, selectedFiles, 'tracked'),
    [filteredTracked, selectedFiles],
  );
  const unversionedDiscardIntent = useMemo(
    () => buildGroupDiscardIntent(flattenedUntracked, selectedFiles, 'unversioned'),
    [flattenedUntracked, selectedFiles],
  );

  // 行内按钮：分组已知 → 类别在绑定时定死，引用稳定（Section 是 memo 组件）。
  const discardTrackedRow = useCallback(
    (path: string) => onDiscard(buildFileDiscardIntent(path, 'tracked')),
    [onDiscard],
  );
  const discardUnversionedRow = useCallback(
    (path: string) => onDiscard(buildFileDiscardIntent(path, 'unversioned')),
    [onDiscard],
  );

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
          onDiscardFile={discardTrackedRow}
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
            trackedDiscardIntent && (
              <GroupDiscardButton
                intent={trackedDiscardIntent}
                disabled={loading}
                onClick={() => onDiscard(trackedDiscardIntent)}
              />
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
          onDiscardFile={discardUnversionedRow}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          loading={loading}
          headerAction={
            <span className="flex items-center gap-1">
              {unversionedDiscardIntent && (
                <GroupDiscardButton
                  intent={unversionedDiscardIntent}
                  disabled={loading}
                  onClick={() => onDiscard(unversionedDiscardIntent)}
                />
              )}
              {onStageAllUntracked && (
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
              )}
            </span>
          }
        />
      )}
    </div>
  );
};

export default React.memo(ChangesList);
