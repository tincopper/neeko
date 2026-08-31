import React from 'react';

import { cn } from '@/lib/utils';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileCode2,
  FoldVertical,
  MoreHorizontal,
  Sparkles,
  SquareSplitHorizontal,
  SquareSplitVertical,
  UnfoldVertical,
} from '@/shared/components/icons';

import type { ViewMode } from './types';

/** Flat icon button (no box/border). Used for nav and action buttons. */
export const flatBtnClass =
  'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover/80 disabled:opacity-35 disabled:pointer-events-none transition-colors';

interface ToolbarControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** 全文模式（未折叠 diff）切换。 */
  fullMode?: boolean;
  onToggleFull?: () => void;
  showFoldToggle?: boolean;
  /** Combined bulk fold: true when every section is collapsed. */
  allCollapsed?: boolean;
  onToggleFoldAll?: () => void;
  onOpenFile?: () => void;
  /** Open File 置灰条件（diff 加载中/出错）；undefined 时不渲染按钮 */
  openFileDisabled?: boolean;
  onReview?: () => void;
}

/**
 * Diff 工具栏右侧控制区：视图模式切换、全文/批量折叠切换、Open File、
 * Review 与 overflow 菜单（菜单开合状态自内聚，不外泄到工具栏主体）。
 */
const ToolbarControls: React.FC<ToolbarControlsProps> = ({
  viewMode,
  onViewModeChange,
  fullMode,
  onToggleFull,
  showFoldToggle,
  allCollapsed,
  onToggleFoldAll,
  onOpenFile,
  openFileDisabled,
  onReview,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-px shrink-0">
      {/* View mode toggle */}
      <button
        type="button"
        className={flatBtnClass}
        onClick={() => onViewModeChange(viewMode === 'unified' ? 'split' : 'unified')}
        title={viewMode === 'unified' ? 'Switch to split view' : 'Switch to unified view'}
        aria-label={viewMode === 'unified' ? 'Switch to split view' : 'Switch to unified view'}
        aria-pressed={viewMode === 'split'}
      >
        {viewMode === 'unified' ? (
          <SquareSplitVertical size={14} />
        ) : (
          <SquareSplitHorizontal size={14} />
        )}
      </button>

      {onToggleFull ? (
        <button
          type="button"
          className={flatBtnClass}
          onClick={onToggleFull}
          title={fullMode ? 'Collapse full diff' : 'Expand full diff'}
          aria-label={fullMode ? 'Collapse full diff' : 'Expand full diff'}
          aria-pressed={fullMode}
        >
          {fullMode ? <FoldVertical size={14} /> : <UnfoldVertical size={14} />}
        </button>
      ) : null}

      {showFoldToggle ? (
        <button
          type="button"
          className={flatBtnClass}
          onClick={onToggleFoldAll}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
        >
          {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
      ) : null}

      {onOpenFile ? (
        <button
          type="button"
          className={flatBtnClass}
          onClick={onOpenFile}
          disabled={openFileDisabled}
          title="Open File"
          aria-label="Open File"
        >
          <FileCode2 size={14} />
        </button>
      ) : null}

      {onReview ? (
        <button
          type="button"
          className={cn(
            flatBtnClass,
            'text-accent-blue hover:text-accent-blue hover:bg-accent-blue/15',
          )}
          onClick={onReview}
          title="Review this change"
          aria-label="Review this change"
        >
          <Sparkles size={14} />
        </button>
      ) : null}

      {/* Overflow */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className={flatBtnClass}
          onClick={() => setMenuOpen((v) => !v)}
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-bg-secondary shadow-lg py-0.5">
            {onReview ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  setMenuOpen(false);
                  onReview();
                }}
              >
                <Sparkles size={12} />
                Review change
              </button>
            ) : null}
            {showFoldToggle ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleFoldAll?.();
                }}
              >
                {allCollapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            ) : null}
            {onToggleFull ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleFull();
                }}
              >
                {fullMode ? <FoldVertical size={12} /> : <UnfoldVertical size={12} />}
                {fullMode ? 'Collapse full diff' : 'Expand full diff'}
              </button>
            ) : null}
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={() => {
                setMenuOpen(false);
                onViewModeChange(viewMode === 'unified' ? 'split' : 'unified');
              }}
            >
              {viewMode === 'unified' ? (
                <SquareSplitVertical size={12} />
              ) : (
                <SquareSplitHorizontal size={12} />
              )}
              {viewMode === 'unified' ? 'Switch to split view' : 'Switch to unified view'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(ToolbarControls);
