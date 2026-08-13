import React from 'react';

import { cn } from '@/lib/utils';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Expand,
  MoreHorizontal,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  Shrink,
  Sparkles,
} from '@/shared/components/icons';

import type { ViewMode } from './types';

interface DiffToolbarProps {
  title: string;
  subtitle?: string;
  titleTooltip?: string;
  iconSrc?: string;
  additions: number;
  deletions: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Change-hunk navigation (↑/↓). Present in single + combined. */
  changeIndex: number;
  changeTotal: number;
  onChangePrev: () => void;
  onChangeNext: () => void;
  /** File navigation (←/→). Combined mode only. */
  showFileNav?: boolean;
  fileIndex?: number;
  fileTotal?: number;
  onFilePrev?: () => void;
  onFileNext?: () => void;
  /** Combined bulk fold: true when every section is collapsed. */
  showFoldToggle?: boolean;
  allCollapsed?: boolean;
  onToggleFoldAll?: () => void;
  /** 全文模式（未折叠 diff）切换。 */
  fullMode?: boolean;
  onToggleFull?: () => void;
  onReview?: () => void;
}

/** Flat icon button (no box/border). Used for nav and action buttons. */
const flatBtnClass =
  'inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover/80 disabled:opacity-35 disabled:pointer-events-none transition-colors';

const DiffToolbar: React.FC<DiffToolbarProps> = ({
  title,
  titleTooltip,
  iconSrc,
  additions,
  deletions,
  viewMode,
  onViewModeChange,
  changeIndex,
  changeTotal,
  onChangePrev,
  onChangeNext,
  showFileNav,
  fileIndex = 0,
  fileTotal = 0,
  onFilePrev,
  onFileNext,
  showFoldToggle,
  allCollapsed,
  onToggleFoldAll,
  fullMode,
  onToggleFull,
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

  const canChangePrev = changeTotal > 0 && changeIndex > 0;
  const canChangeNext = changeTotal > 0 && changeIndex < changeTotal - 1;
  const canFilePrev = !!showFileNav && fileTotal > 0 && fileIndex > 0;
  const canFileNext = !!showFileNav && fileTotal > 0 && fileIndex < fileTotal - 1;

  const metaBits: string[] = [];
  if (showFileNav && fileTotal > 0) {
    metaBits.push(`${fileTotal} ${fileTotal === 1 ? 'file' : 'files'}`);
  }
  if (changeTotal > 0) {
    metaBits.push(`${changeTotal} ${changeTotal === 1 ? 'change' : 'changes'}`);
  }
  const metaText = metaBits.join(' · ');
  const metaTooltip = [
    showFileNav && fileTotal > 0
      ? `File ${Math.min(fileIndex + 1, fileTotal)} of ${fileTotal}`
      : null,
    changeTotal > 0 ? `Change ${Math.min(changeIndex + 1, changeTotal)} of ${changeTotal}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const hasStats = additions > 0 || deletions > 0;

  return (
    <div
      className="@container flex items-center gap-1 px-2.5 py-1.5 min-h-9 bg-bg-secondary/95 border-b border-border/40 shrink-0"
      role="toolbar"
      aria-label="Diff toolbar"
    >
      {/* ── Left: navigation arrows ────────────────────────────────── */}
      <div className="flex items-center gap-px shrink-0" role="group" aria-label="Diff navigation">
        {showFileNav ? (
          <button
            type="button"
            className={flatBtnClass}
            onClick={onFilePrev}
            disabled={!canFilePrev}
            title="Previous file"
            aria-label="Previous file"
          >
            <MoveLeft size={14} />
          </button>
        ) : null}
        {showFileNav ? (
          <button
            type="button"
            className={flatBtnClass}
            onClick={onFileNext}
            disabled={!canFileNext}
            title="Next file"
            aria-label="Next file"
          >
            <MoveRight size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className={flatBtnClass}
          onClick={onChangePrev}
          disabled={!canChangePrev}
          title="Previous change"
          aria-label="Previous change"
        >
          <MoveUp size={14} />
        </button>
        <button
          type="button"
          className={flatBtnClass}
          onClick={onChangeNext}
          disabled={!canChangeNext}
          title="Next change"
          aria-label="Next change"
        >
          <MoveDown size={14} />
        </button>
      </div>

      {showFileNav || changeTotal > 0 ? (
        <div className="w-px h-4 bg-border/20 shrink-0 mx-0.5" />
      ) : null}

      {/* ── Center: identity ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {iconSrc ? (
          <img src={iconSrc} alt="" width={15} height={15} className="shrink-0 opacity-90" />
        ) : null}
        <span
          className="text-[var(--font-size)] font-semibold text-text-primary truncate leading-none"
          title={titleTooltip ?? title}
        >
          {title}
        </span>
        {metaText ? (
          <span
            className="hidden @[360px]:inline shrink-0 rounded-full bg-bg-tertiary/70 px-1.5 py-0.5 text-[calc(var(--font-size)-3px)] text-text-muted tabular-nums leading-none"
            title={metaTooltip || undefined}
          >
            {metaText}
          </span>
        ) : null}
        {hasStats ? (
          <span className="shrink-0 flex items-center gap-1 rounded-full border border-border/30 bg-bg-tertiary/50 px-1.5 py-0.5 text-[calc(var(--font-size)-2px)] tabular-nums leading-none">
            <span className="text-accent-green font-medium">+{additions}</span>
            <span className="text-text-muted/50">/</span>
            <span className="text-accent-red font-medium">−{deletions}</span>
          </span>
        ) : null}
      </div>

      {/* ── Right: controls ────────────────────────────────────────── */}
      <div className="flex items-center gap-px shrink-0">
        {/* View mode — keep segmented group for selection affordance */}
        <div
          className="flex items-center rounded-md border border-border/30 bg-bg-tertiary/40 p-0.5"
          role="group"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            className={cn(
              'px-1.5 py-0.5 rounded text-[calc(var(--font-size)-2px)] font-medium transition-colors duration-150',
              viewMode === 'unified'
                ? 'bg-accent-blue/15 text-accent-blue'
                : 'text-text-muted hover:text-text-secondary',
            )}
            onClick={() => onViewModeChange('unified')}
            title="Unified view"
          >
            <span className="hidden @[420px]:inline">Unified</span>
            <span className="@[420px]:hidden">U</span>
          </button>
          <button
            type="button"
            className={cn(
              'px-1.5 py-0.5 rounded text-[calc(var(--font-size)-2px)] font-medium transition-colors duration-150',
              viewMode === 'split'
                ? 'bg-accent-blue/15 text-accent-blue'
                : 'text-text-muted hover:text-text-secondary',
            )}
            onClick={() => onViewModeChange('split')}
            title="Split view"
          >
            <span className="hidden @[420px]:inline">Split</span>
            <span className="@[420px]:hidden">S</span>
          </button>
        </div>

        {onToggleFull ? (
          <button
            type="button"
            className={flatBtnClass}
            onClick={onToggleFull}
            title={fullMode ? 'Collapse full diff' : 'Expand full diff'}
            aria-label={fullMode ? 'Collapse full diff' : 'Expand full diff'}
            aria-pressed={fullMode}
          >
            {fullMode ? <Shrink size={14} /> : <Expand size={14} />}
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
                  {fullMode ? <Shrink size={12} /> : <Expand size={12} />}
                  {fullMode ? 'Collapse full diff' : 'Expand full diff'}
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  setMenuOpen(false);
                  onViewModeChange('unified');
                }}
              >
                Unified view
              </button>
              <button
                type="button"
                className="flex w-full px-2 py-1.5 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                onClick={() => {
                  setMenuOpen(false);
                  onViewModeChange('split');
                }}
              >
                Split view
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default React.memo(DiffToolbar);
