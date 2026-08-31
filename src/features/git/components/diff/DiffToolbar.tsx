import React from 'react';

import { MoveDown, MoveLeft, MoveRight, MoveUp } from '@/shared/components/icons';

import ToolbarControls, { flatBtnClass } from './ToolbarControls';
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
  /** 打开当前 diff 对应的工作区文件（仅工作区 diff 且 projectId 可用时提供） */
  onOpenFile?: () => void;
  /** Open File 置灰条件（diff 加载中/出错）；按钮仍渲染，仅禁用 */
  openFileDisabled?: boolean;
}

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
  onOpenFile,
  openFileDisabled,
}) => {
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

      {/* ── Right: controls（ToolbarControls 内聚菜单开合状态） ─────── */}
      <ToolbarControls
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        fullMode={fullMode}
        onToggleFull={onToggleFull}
        showFoldToggle={showFoldToggle}
        allCollapsed={allCollapsed}
        onToggleFoldAll={onToggleFoldAll}
        onOpenFile={onOpenFile}
        openFileDisabled={openFileDisabled}
        onReview={onReview}
      />
    </div>
  );
};

export default React.memo(DiffToolbar);
