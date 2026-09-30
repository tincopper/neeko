import { memo } from 'react';

import { ChevronRight } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

/** 相对路径 → basename / dirname（组头：文件名主色 + 父目录暗色；根级文件无 dirname）。 */
function splitLabel(label: string): { name: string; dir: string } {
  const idx = label.lastIndexOf('/');
  if (idx < 0) return { name: label, dir: '' };
  return { name: label.slice(idx + 1), dir: label.slice(0, idx) };
}

interface DiagnosticGroupHeaderProps {
  uri: string;
  label: string;
  count: number;
  isCollapsed: boolean;
  /** 折叠翻转子（父组件经 `useCallback` 稳定引用，memo 才生效）。 */
  onToggle: (uri: string) => void;
}

/**
 * 文件组头（VS Code 视觉契约 1）：折叠 chevron + 文件类型图标 + 文件名（主色）+
 * 父目录（暗色）+ 计数徽章。
 *
 * `React.memo`：props 全为原始值 + 稳定回调，因此**未变的分组不触发组头重渲染**（同一文件里
 * 只改诊断内容、条数不变时，组头也无事可做）。这是分组增量渲染的第二道闸：`DiagnosticGroup`
 * 挡住整个分组的重渲染，本组件再挡住「分组变了但组头展示值没变」的那一类。
 */
export const DiagnosticGroupHeader = memo(function DiagnosticGroupHeader({
  uri,
  label,
  count,
  isCollapsed,
  onToggle,
}: DiagnosticGroupHeaderProps) {
  const { name, dir } = splitLabel(label);

  return (
    <button
      type="button"
      data-testid={`diagnostics-group-header-${label}`}
      onClick={() => onToggle(uri)}
      aria-expanded={!isCollapsed}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-bg-hover transition-colors text-left cursor-pointer"
    >
      <ChevronRight
        size={12}
        className={`shrink-0 text-text-muted transition-transform${isCollapsed ? '' : ' rotate-90'}`}
      />
      <img src={fileIconSrc(name)} alt="" className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium text-text-primary truncate">{name}</span>
      {dir && <span className="text-text-muted truncate">{dir}</span>}
      <span
        data-testid="diagnostic-group-count"
        className="ml-auto shrink-0 rounded-full bg-bg-hover px-1.5 text-[10px] leading-4 py-px text-text-muted"
      >
        {count}
      </span>
    </button>
  );
});
