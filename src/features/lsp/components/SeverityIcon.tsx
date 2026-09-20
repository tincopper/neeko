import { AlertTriangle, CircleDot, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';

/**
 * 诊断严重度的行首图标 —— 一律用 **lucide**（不在本地手写 SVG path）。
 *
 * 两个渲染宿主共用同一份 lucide 组件映射：
 * - React 版（Problems 面板行）：直接渲染 lucide 组件；
 * - 原生 DOM 版（编辑器 hover popup，CM6 tooltip 不能挂 React）：用
 *   `renderToStaticMarkup` 把同一组件渲染成 SVG 字符串（`searchPanel.ts` 同款先例）。
 *
 * 配色（VS Code Problems 同构）：⊗ 红 / ⚠ 黄 / ℹ 蓝 / 暗点。
 */

export type SeverityName = 'error' | 'warning' | 'info' | 'hint';

/** LSP severity 数值 → 语义名（1 error / 2 warning / 3 info / 其余 hint）。 */
export function severityName(severity: number | null): SeverityName {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  if (severity === 3) return 'info';
  return 'hint';
}

/** 行首图标配色类（红色 / 黄色 / 蓝色 / 暗色）。 */
export function severityColorClass(severity: number | null): string {
  switch (severityName(severity)) {
    case 'error':
      return 'text-red-500';
    case 'warning':
      return 'text-yellow-500';
    case 'info':
      return 'text-blue-500';
    default:
      return 'text-text-muted';
  }
}

/** severity → lucide 图标（唯一映射：面板与 popup 同一份）。 */
const SEVERITY_ICONS: Record<SeverityName, LucideIcon> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  hint: CircleDot,
};

/** React 版（Problems 面板行用；颜色由外层 span 承载，图标继承 currentColor）。 */
export function SeverityIcon({
  severity,
  size = 14,
}: {
  severity: number | null;
  size?: number;
}): ReactNode {
  const Icon = SEVERITY_ICONS[severityName(severity)];
  return <Icon size={size} />;
}

/** 原生 DOM 版（编辑器 hover popup / gutter 用）：renderToStaticMarkup 复用同一 lucide 图标。 */
export function severitySvgMarkup(severity: number | null, size = 14): string {
  const Icon = SEVERITY_ICONS[severityName(severity)];
  return renderToStaticMarkup(<Icon size={size} />);
}
