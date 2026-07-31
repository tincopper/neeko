import type { KeyboardEvent, MouseEvent, RefObject } from 'react';

import type { CommitDetail, CommitEntry, CommitFileChange } from '@/features/git/types';
import { cn } from '@/lib/utils';
import { Copy, MoreHorizontal } from '@/shared/components/icons';

import { CommitExpandPanel } from './CommitExpandPanel';
import {
  formatAbsoluteTime,
  formatRefs,
  formatRelativeTime,
  parseCommitMessage,
  typeStyle,
} from './commitListUtils';
import { CommitRowMenu } from './CommitRowMenu';
import { ROW_HEIGHT } from './virtualScroll';

export interface CommitListItemProps {
  commit: CommitEntry;
  /** 该行文字左内边距：rowMaxX[rowIdx] + TEXT_AFTER_DOT_GAP（组合层计算） */
  textLeft: number;
  isSelected: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  onHoveredChange: (hash: string | null) => void;
  onSelectCommit: (hash: string) => void;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  focusedFileIndex?: number;
  /** useExpandPanel 测量用（ref drilling） */
  expandRef: RefObject<HTMLDivElement>;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  /** 本行菜单是否打开（组合层 isMenuOpen(commit.hash)） */
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement>;
  onToggleMenu: () => void;
}

/**
 * 单条 commit 行（纯展示：data-in, events-out，无任何 hook）。
 * dot 由 CommitGraph 绘制；hover 状态由组合层持有并下传。
 */
export function CommitListItem({
  commit,
  textLeft,
  isSelected,
  isExpanded,
  isHovered,
  onHoveredChange,
  onSelectCommit,
  detail,
  files,
  detailLoading,
  detailError,
  focusedFileIndex = -1,
  expandRef,
  onOpenDiff,
  onPinFile,
  menuOpen,
  menuRef,
  onToggleMenu,
}: CommitListItemProps) {
  const { type, scope, subject, header } = parseCommitMessage(commit.message);
  const refs = commit.refs ? formatRefs(commit.refs) : null;
  const absTime = formatAbsoluteTime(commit.timestamp);
  const relTime = formatRelativeTime(commit.timestamp);

  const handleRowClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.commit-expand')) return;
    onSelectCommit(commit.hash);
  };

  return (
    <div className="relative min-w-0">
      <div
        role="button"
        tabIndex={0}
        data-testid="commit-row"
        className={cn(
          'relative z-10 flex flex-col justify-center pr-2 cursor-pointer group transition-colors duration-100 min-w-0',
          // Hover/selection 只在 commit 行——不含下方展开面板
          isExpanded
            ? 'bg-bg-selected'
            : isSelected
              ? 'bg-bg-selected/70'
              : isHovered
                ? 'bg-bg-hover'
                : undefined,
        )}
        style={{ height: ROW_HEIGHT, paddingLeft: textLeft }}
        onMouseEnter={() => onHoveredChange(commit.hash)}
        onMouseLeave={() => onHoveredChange(null)}
        onClick={handleRowClick}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectCommit(commit.hash);
          }
        }}
      >
        <div className="flex items-center gap-1 min-w-0">
          {type ? (
            <span
              className={cn(
                'shrink-0 max-w-[10rem] truncate text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none',
                typeStyle(type),
              )}
              title={scope ? `${type}(${scope})` : type}
            >
              {scope ? `${type}(${scope})` : type}
            </span>
          ) : null}
          <span
            className="flex-1 truncate text-[var(--font-size)] text-text-primary leading-tight"
            title={header}
          >
            {subject}
          </span>
          <button
            type="button"
            className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-100"
            title="Copy full hash"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(commit.hash);
            }}
          >
            <Copy size={10} />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-100"
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu();
            }}
          >
            <MoreHorizontal size={10} />
          </button>
        </div>
        <div className="flex items-center gap-1 min-w-0 mt-0.5">
          <span
            className="text-[calc(var(--font-size)-2px)] text-text-muted truncate leading-tight"
            style={{ maxWidth: 72 }}
            title={commit.author}
          >
            {commit.author}
          </span>
          <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">
            ·
          </span>
          <span
            className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight"
            title={absTime}
          >
            {relTime}
          </span>
          <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">
            ·
          </span>
          <span
            className="text-[calc(var(--font-size)-2px)] font-mono text-text-muted shrink-0 leading-tight"
            title={commit.hash}
          >
            {commit.short_hash}
          </span>
          {refs ? (
            <span
              className="ml-auto shrink-0 text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none bg-accent-yellow/10 text-accent-yellow truncate max-w-[96px]"
              title={refs.title}
            >
              {refs.primary}
              {refs.extraCount > 0 ? ` +${refs.extraCount}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <CommitExpandPanel
          detail={detail}
          files={files}
          detailLoading={detailLoading}
          detailError={detailError}
          focusedFileIndex={focusedFileIndex}
          marginLeft={textLeft - 2}
          expandRef={expandRef}
          onOpenDiff={onOpenDiff}
          onPinFile={onPinFile}
        />
      ) : null}

      {menuOpen ? <CommitRowMenu menuRef={menuRef} /> : null}
    </div>
  );
}
