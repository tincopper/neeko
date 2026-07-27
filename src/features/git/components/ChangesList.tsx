import React, { useMemo, useState, useCallback } from 'react';

import { cn } from '@/lib/utils';
import {
  ChevronRightIcon,
  Undo2,
  Plus,
  Minus,
  ListPlus,
  Pencil,
  FilePlus,
  Trash2,
  FileText,
} from '@/shared/components/icons';
import type { FileChange } from '@/shared/types';
import { Checkbox } from '@/ui/Checkbox';

// ── Status icons ─────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  Modified: { icon: <Pencil size={11} />, color: 'text-accent-blue' },
  Added: { icon: <FilePlus size={11} />, color: 'text-accent-green' },
  Deleted: { icon: <Trash2 size={11} />, color: 'text-accent-red' },
  Renamed: { icon: <FileText size={11} />, color: 'text-accent-orange' },
  Untracked: { icon: <FilePlus size={11} />, color: 'text-text-muted' },
};

// ── Path utilities ───────────────────────────────────────────────────────────

function splitFilePath(path: string): { name: string; directory: string } {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) return { name: path, directory: '' };
  return {
    name: path.slice(lastSlash + 1),
    directory: path.slice(0, lastSlash + 1),
  };
}

interface ChangesListProps {
  files: FileChange[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onDiscardFile: (path: string) => void;
  onDiscardAll?: () => void;
  onStageFile?: (path: string) => void;
  onStageAllUntracked?: () => void;
  onFileSelect?: (path: string) => void;
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
  loading,
}) => {
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [unversionedExpanded, setUnversionedExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const trackedFiles = useMemo(() => files.filter((f) => f.status !== 'Untracked'), [files]);

  const untrackedFiles = useMemo(() => files.filter((f) => f.status === 'Untracked'), [files]);

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
      {untrackedFiles.length > 0 && (
        <Section
          title="Unversioned"
          count={untrackedFiles.length}
          expanded={unversionedExpanded}
          onToggle={() => setUnversionedExpanded((v) => !v)}
          files={untrackedFiles}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(untrackedFiles)}
          onSelectAll={() => handleSelectGroup(untrackedFiles)}
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

// ── Reusable collapsible section ──

interface SectionProps {
  title: string;
  count: number;
  additions?: number;
  deletions?: number;
  expanded: boolean;
  onToggle: () => void;
  files: FileChange[];
  selectedFiles: Set<string>;
  allSelected: boolean;
  onSelectAll: () => void;
  onToggleFile: (path: string) => void;
  onFileSelect?: (path: string) => void;
  onDiscardFile: (path: string) => void;
  onStageFile?: (path: string) => void;
  loading: boolean;
  filter?: React.ReactNode;
  headerAction?: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  count,
  additions,
  deletions,
  expanded,
  onToggle,
  files,
  selectedFiles,
  allSelected,
  onSelectAll,
  onToggleFile,
  onFileSelect,
  onDiscardFile,
  onStageFile,
  loading,
  filter,
  headerAction,
}) => {
  return (
    <div className="flex flex-col shrink-0 mb-1">
      {/* Header: Chevron �?Checkbox �?Title �?Count �?Stats �?Filter */}
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors duration-100 hover:bg-bg-hover select-none shrink-0">
        <ChevronRightIcon
          size={9}
          className={cn(
            'text-[0.6em] w-2.5 shrink-0 transition-transform duration-150 text-text-muted cursor-pointer',
            expanded && 'rotate-90',
          )}
          onClick={onToggle}
        />
        <Checkbox checked={allSelected} onCheckedChange={onSelectAll} />
        <span
          role="button"
          tabIndex={0}
          className="text-[calc(var(--font-size)-2px)] font-semibold uppercase tracking-[0.06em] text-text-muted cursor-pointer hover:text-text-secondary"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {title} ({count})
        </span>
        {additions != null && additions > 0 && (
          <span className="text-[#3fb950] text-[calc(var(--font-size)-2px)] font-semibold">
            +{additions}
          </span>
        )}
        {deletions != null && deletions > 0 && (
          <span className="text-[#f85149] text-[calc(var(--font-size)-2px)] font-semibold">
            -{deletions}
          </span>
        )}
        {filter && <span className="ml-auto">{filter}</span>}
        {headerAction && <span className={cn(!filter && 'ml-auto')}>{headerAction}</span>}
      </div>

      {/* File list */}
      {expanded && (
        <div className="flex flex-col">
          {files.map((file) => {
            const isSelected = selectedFiles.has(file.path);
            const statusInfo = STATUS_ICONS[file.status] ?? STATUS_ICONS.Modified;
            const { name, directory } = splitFilePath(file.path);
            return (
              <div
                key={file.path}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                className={cn(
                  'flex items-center gap-x-1.5 px-1.5 py-1 rounded cursor-pointer min-w-0 w-full overflow-hidden transition-colors duration-100 group',
                  isSelected ? 'bg-bg-selected text-text-primary' : 'hover:bg-bg-hover/60',
                )}
                onClick={() => onFileSelect?.(file.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onFileSelect?.(file.path);
                  }
                }}
                title={`${file.path}  ${file.additions > 0 ? `+${file.additions}` : ''} ${file.deletions > 0 ? `-${file.deletions}` : ''}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleFile(file.path)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  className="shrink-0"
                />
                <span className={cn('shrink-0', statusInfo.color)}>{statusInfo.icon}</span>
                <span className="shrink-0 max-w-[9rem] truncate text-[calc(var(--font-size)-1px)] font-mono text-text-primary">
                  {name}
                </span>
                <span className="flex-1 min-w-0 truncate text-[calc(var(--font-size)-3px)] font-mono text-text-muted">
                  {directory}
                </span>
                <span className="shrink-0 flex items-center gap-1 justify-end tabular-nums">
                  {file.additions > 0 && (
                    <span className="flex items-center gap-px text-accent-green whitespace-nowrap">
                      <Plus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{file.additions}</span>
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className="flex items-center gap-px text-accent-red whitespace-nowrap">
                      <Minus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{file.deletions}</span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                  <button
                    className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100"
                    title="Discard changes"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscardFile(file.path);
                    }}
                    disabled={loading}
                  >
                    <Undo2 size={12} />
                  </button>
                  {onStageFile && (
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-green hover:bg-bg-hover transition-colors duration-100"
                      title="Stage file (git add)"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStageFile(file.path);
                      }}
                      disabled={loading}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(ChangesList);
