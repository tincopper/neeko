import { Sparkles } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server.browser';

/**
 * quickfix 图标：
 * - 灯泡 = 原型 `#i-bulb` 的唯一实现（菜单两宿主 + gutter 共用一份 path，防漂移）；
 * - AI sparkle = 复用应用统一的 **lucide `Sparkles`**（与其他 AI 场景同一图标，
 *   不本地手写 path）。原生 DOM 侧经 `renderToStaticMarkup`（searchPanel 同款）渲染。
 *
 * 颜色由调用方给（选中行用 `--accent-yellow`，AI 用 `--accent-blue`，gutter 继承当前文字色）。
 */

/** 原型 `#i-bulb` 的 path 数据（`d` 属性，按顺序绘制）。 */
export const BULB_PATH_DATA = [
  'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
  'M9 18h6',
  'M10 22h4',
] as const;

/** 原生 DOM 版（编辑器内菜单 / gutter 标记用）。 */
export const BULB_SVG_MARKUP =
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  BULB_PATH_DATA.map((d) => `<path d="${d}"/>`).join('') +
  `</svg>`;

/** AI 动作（Fix / Explain）的 sparkle —— 原生 DOM 版（lucide `Sparkles` 静态字符串）。 */
export function sparklesSvgMarkup(size = 12, strokeWidth?: number): string {
  return renderToStaticMarkup(<Sparkles size={size} strokeWidth={strokeWidth} />);
}

interface QuickFixBulbIconProps {
  size?: number;
  className?: string;
}

/** React 版（Problems 行内菜单用）。 */
export function QuickFixBulbIcon({ size = 12, className }: QuickFixBulbIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {BULB_PATH_DATA.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** React 版 sparkle（Problems 行内菜单的 AI 条目用）—— 复用应用统一的 lucide `Sparkles`。 */
export function QuickFixSparkleIcon({ size = 12, className }: QuickFixBulbIconProps) {
  return <Sparkles size={size} className={className} />;
}
